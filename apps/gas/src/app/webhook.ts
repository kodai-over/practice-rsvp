import {
  canRegister,
  confirmCard,
  goingList,
  labelDate,
  looksLikeReservation,
  parsePostback,
  practiceListMessage,
  shortDate,
  toJstDate,
  type LineMessage,
  type NewPracticeInput,
} from '@pb/shared';
import { UserError, type Ctx, type RawReservation } from './ports';
import {
  buildDraft,
  createPractices,
  ensureMember,
  loadDraft,
  readReservations,
  recordAnswer,
  removeDraft,
  saveDraft,
  upcoming,
} from './practices';

// LINE Webhook のイベント（使う項目だけ）
interface Source {
  type: 'user' | 'group' | 'room';
  userId?: string;
  groupId?: string;
  roomId?: string;
}

export interface LineEvent {
  type: string;
  replyToken?: string;
  source: Source;
  message?: { id: string; type: string; text?: string; imageSet?: { id: string; index: number; total: number } };
  postback?: { data: string };
}

export function handleWebhook(ctx: Ctx, body: { events?: LineEvent[] }): void {
  for (const ev of body.events ?? []) {
    try {
      handleEvent(ctx, ev);
    } catch (e) {
      ctx.log('event error', ev.type, e);
      if (e instanceof UserError && ev.replyToken) safeReply(ctx, ev, [textMsg(e.message)]);
    }
  }
}

function handleEvent(ctx: Ctx, ev: LineEvent): void {
  switch (ev.type) {
    case 'message':
      if (ev.message?.type === 'text') return onText(ctx, ev);
      if (ev.message?.type === 'image') return onImage(ctx, ev);
      return;
    case 'postback':
      return onPostback(ctx, ev);
    case 'join':
      return onJoin(ctx, ev);
    case 'leave':
      return onLeave(ctx, ev);
    case 'follow':
      if (ev.source.userId) ensureMember(ctx, ev.source.userId);
      return;
  }
}

const textMsg = (text: string): LineMessage => ({ type: 'text', text });
const chatId = (s: Source) => s.groupId ?? s.roomId ?? s.userId ?? '';

function safeReply(ctx: Ctx, ev: LineEvent, messages: LineMessage[]): boolean {
  if (!ev.replyToken) return false;
  try {
    ctx.line.reply(ev.replyToken, messages);
    return true;
  } catch (e) {
    ctx.log('reply failed', e);
    return false;
  }
}

// ---------------------------------------------------------------- テキスト

function onText(ctx: Ctx, ev: LineEvent): void {
  const text = (ev.message?.text ?? '').trim();
  if (text === '練習') {
    const groupId = ev.source.type === 'user' ? undefined : chatId(ev.source);
    const practices = upcoming(ctx, groupId);
    const att = ctx.store.attendance();
    const items = practices.map((practice) => ({ practice, going: goingList(att, practice.id).length }));
    safeReply(ctx, ev, [practiceListMessage(items, ctx.config.appUrl)]);
    return;
  }
  // グループでの会話には反応しない。個別トークで予約内容らしい文章が来たら読み取る
  if (ev.source.type !== 'user' || !ev.source.userId) return;
  if (looksLikeReservation(text)) {
    registerFrom(ctx, ev, ev.source.userId, { text });
    return;
  }
  safeReply(ctx, ev, [
    textMsg(
      '予約画面のスクショか、予約内容の文章（予約完了メールなど）を送ると、練習を登録できます。\n「練習」と送ると、今後の練習の一覧を返します。\n' +
        ctx.config.appUrl,
    ),
  ]);
}

// ---------------------------------------------------------------- スクショ・文章からの登録

function onImage(ctx: Ctx, ev: LineEvent): void {
  if (ev.source.type !== 'user' || !ev.source.userId || !ev.message) return;
  const userId = ev.source.userId;
  const messageIds = collectImageSet(ctx, userId, ev.message);
  if (!messageIds) return; // 複数枚送信のうち、まだ全部届いていない
  registerFrom(ctx, ev, userId, { messageIds });
}

/** スクショか文章から予約を読み取り、確認カードを返す */
function registerFrom(ctx: Ctx, ev: LineEvent, userId: string, src: { messageIds?: string[]; text?: string }): void {
  const member = ensureMember(ctx, userId);
  if (!canRegister(member)) {
    safeReply(ctx, ev, [textMsg('練習を登録できません。管理者に確認してください。')]);
    return;
  }
  const what = src.text ? '予約内容' : 'スクショ';
  let raws: RawReservation[];
  try {
    const images = (src.messageIds ?? []).map((id) => ctx.line.content(id));
    raws = readReservations(ctx, { images, text: src.text });
  } catch (e) {
    ctx.log('read error', e);
    sendToUser(ctx, ev, userId, [
      textMsg(`${what}の読み取りでエラーが起きました。時間をおいてもう一度送るか、アプリの「＋ 登録」から入力してください。\n${ctx.config.appUrl}`),
    ]);
    return;
  }
  if (raws.length === 0) {
    sendToUser(ctx, ev, userId, [
      textMsg(`${what}から予約を読み取れませんでした。予約完了画面や予約一覧を送るか、アプリの「＋ 登録」から入力してください。\n${ctx.config.appUrl}`),
    ]);
    return;
  }
  const draft = buildDraft(ctx, member, raws);
  saveDraft(ctx, draft);
  const card = confirmCard({ draft, groups: ctx.store.settings().groups, practices: ctx.store.practices(), appUrl: ctx.config.appUrl });
  sendToUser(ctx, ev, userId, [card]);
}

/** 応答メッセージで返し、間に合わなかったときだけプッシュで送る */
function sendToUser(ctx: Ctx, ev: LineEvent, userId: string, messages: LineMessage[]): void {
  if (!safeReply(ctx, ev, messages)) ctx.line.push(userId, messages);
}

/**
 * 複数枚まとめて送られた画像（imageSet）は、全部そろったときにまとめて読み取る。
 * そろったら index 順のメッセージIDを返し、まだなら null。
 */
function collectImageSet(ctx: Ctx, userId: string, message: NonNullable<LineEvent['message']>): string[] | null {
  const set = message.imageSet;
  if (!set || set.total <= 1) return [message.id];
  const key = `imgset:${userId}:${set.id}`;
  return ctx.withLock(() => {
    const got: { index: number; id: string }[] = JSON.parse(ctx.kv.get(key) ?? '[]');
    if (!got.some((g) => g.index === set.index)) got.push({ index: set.index, id: message.id });
    if (got.length < set.total) {
      ctx.kv.put(key, JSON.stringify(got), 600);
      return null;
    }
    ctx.kv.remove(key);
    return got.sort((a, b) => a.index - b.index).map((g) => g.id);
  });
}

// ---------------------------------------------------------------- ボタン

function onPostback(ctx: Ctx, ev: LineEvent): void {
  const userId = ev.source.userId;
  if (!userId || !ev.postback) return;
  const data = parsePostback(ev.postback.data);
  switch (data.a) {
    case 'rsvp':
      return onRsvp(ctx, ev, userId, data.p, data.v === '1');
    case 'confirm':
      return onConfirm(ctx, ev, userId, data.d);
    case 'discard': {
      const draft = loadDraft(ctx, data.d);
      if (draft && draft.booker === userId) removeDraft(ctx, data.d);
      safeReply(ctx, ev, [textMsg('取り消しました。')]);
      return;
    }
  }
}

function onRsvp(ctx: Ctx, ev: LineEvent, userId: string, practiceId: string, going: boolean): void {
  const groupId = ev.source.groupId;
  const member = ensureMember(ctx, userId, { groupId });
  const res = recordAnswer(
    ctx,
    practiceId,
    { participant: userId, name: member.name, kind: 'メンバー', via: 'ボタン', addedBy: userId },
    going ? '行く' : '行かない',
  );
  // 記録できたときは本人の発言（displayText）が出るので返信しない
  if (!res.ok) {
    const p = ctx.store.getPractice(practiceId);
    safeReply(ctx, ev, [textMsg(p ? `${shortDate(p.date)}の練習は${res.reason}` : res.reason)]);
  }
}

function onConfirm(ctx: Ctx, ev: LineEvent, userId: string, draftId: string): void {
  const draft = loadDraft(ctx, draftId);
  if (!draft || draft.booker !== userId) {
    safeReply(ctx, ev, [textMsg('この確認カードは期限切れか、処理済みです。もう一度スクショを送ってください。')]);
    return;
  }
  const member = ctx.store.getMember(userId);
  if (!member) return;
  removeDraft(ctx, draftId); // 二度押しで募集が二重に出ないよう先に消す
  const inputs: NewPracticeInput[] = draft.items.map((i) => ({ ...i.reservation, max: null, min: null, memo: '' }));
  let result;
  try {
    result = createPractices(ctx, member, inputs, draft.groups);
  } catch (e) {
    saveDraft(ctx, draft);
    throw e;
  }
  const groups = ctx.store.settings().groups;
  const lines: string[] = [];
  if (result.created.length) {
    lines.push(`募集しました（${draft.groups.map((g) => groups.find((x) => x.id === g)?.name ?? g).join('、')}）`);
    for (const id of result.created) {
      const p = ctx.store.getPractice(id);
      if (p) lines.push(`・${labelDate(p.date)} ${p.start}〜${p.end} ${p.studio} ${p.room}`.trim());
    }
  }
  for (const id of result.extended) {
    const p = ctx.store.getPractice(id);
    if (p) lines.push(`${labelDate(p.date)}の練習を${p.end}までに延長しました。`);
  }
  if (result.skipped.length) lines.push(`登録済みの予約${result.skipped.length}件は募集しませんでした。`);
  safeReply(ctx, ev, [textMsg(lines.join('\n') || '登録する予約はありませんでした。')]);
}

// ---------------------------------------------------------------- グループ

function onJoin(ctx: Ctx, ev: LineEvent): void {
  const id = chatId(ev.source);
  if (!id || ev.source.type === 'user') return;
  let name = '';
  try {
    name = ev.source.groupId ? (ctx.line.groupSummary(id)?.groupName ?? '') : '';
  } catch (e) {
    ctx.log('group summary error', e);
  }
  ctx.withLock(() => {
    const s = ctx.store.settings();
    if (!s.groups.some((g) => g.id === id)) {
      s.groups.push({ id, name: name || `グループ${s.groups.length + 1}` });
      ctx.store.saveSettings(s);
    }
  });
  safeReply(ctx, ev, [
    textMsg('練習の募集をお手伝いするBotです。募集メッセージの「行く／行かない」で出欠を出せます。「練習」と送ると今後の練習の一覧を返します。'),
  ]);
}

function onLeave(ctx: Ctx, ev: LineEvent): void {
  const id = chatId(ev.source);
  ctx.withLock(() => {
    const s = ctx.store.settings();
    s.groups = s.groups.filter((g) => g.id !== id);
    ctx.store.saveSettings(s);
  });
}
