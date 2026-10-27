import {
  canRegister,
  canSeePractice,
  confirmCard,
  goingList,
  labelDate,
  looksLikeReservation,
  parsePostback,
  practiceListMessage,
  shortDate,
  skippedNote,
  toJstDate,
  type Answer,
  type LineMessage,
  type NewPracticeInput,
} from '@studio-attendance/shared';
import { UserError, type Ctx, type RawReservation } from './ports';
import {
  buildDraft,
  createPractices,
  ensureMember,
  forgetGroupMember,
  groupLink,
  loadDraft,
  noteGroupMember,
  readReservations,
  recordAnswer,
  removeDraft,
  saveDraft,
  upcoming,
} from './practices';
import { goneKey } from './triggers';

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
  /** memberJoined / memberLeft で入った人・抜けた人 */
  joined?: { members: { type: string; userId?: string }[] };
  left?: { members: { type: string; userId?: string }[] };
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
  // グループで発言したりボタンを押したりした人は、そのグループに入っている
  if (ev.source.type !== 'user' && ev.source.userId && (ev.type === 'message' || ev.type === 'postback')) {
    try {
      noteGroupMember(ctx, chatId(ev.source), ev.source.userId);
    } catch (e) {
      ctx.log('note group member failed', e);
    }
  }
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
    case 'memberJoined':
      return eachUser(ctx, ev.joined?.members, (u) => noteGroupMember(ctx, chatId(ev.source), u));
    case 'memberLeft':
      return eachUser(ctx, ev.left?.members, (u) => forgetGroupMember(ctx, chatId(ev.source), u));
    case 'follow':
      if (ev.source.userId) ensureMember(ctx, ev.source.userId);
      return;
  }
}

/** 1人で失敗しても、残りの人は処理する */
function eachUser(ctx: Ctx, members: { userId?: string }[] | undefined, fn: (userId: string) => void): void {
  for (const u of members ?? []) {
    try {
      if (u.userId) fn(u.userId);
    } catch (e) {
      ctx.log('group member update failed', u.userId, e);
    }
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
    const att = ctx.store.attendance();
    // 個別トークでは、その人に見える練習だけを返す
    const me = groupId ? null : ctx.store.getMember(ev.source.userId ?? '');
    const involved = (id: string) => att.some((a) => a.practiceId === id && (a.participant === me?.userId || a.addedBy === me?.userId));
    const practices = upcoming(ctx, groupId).filter((p) => groupId || canSeePractice(me, p, involved(p.id)));
    const items = practices.map((practice) => ({ practice, going: goingList(att, practice.id).length }));
    safeReply(ctx, ev, [practiceListMessage(items, ctx.config.appUrl, groupId ? (groupLink(ctx, groupId) ?? undefined) : undefined)]);
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
  // 読み取りには数秒〜数十秒かかるので、トークに「入力中…」を出しておく
  try {
    ctx.line.showLoading(userId, 60);
  } catch (e) {
    ctx.log('loading animation failed', e);
  }
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
  if (draft.items.length === 0 && draft.incomplete.length === 0) {
    // すべて対象外なら確認カードは出さない
    sendToUser(ctx, ev, userId, [textMsg(`新しく登録する予約はありませんでした。${skippedNote(draft)}`)]);
    return;
  }
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
      return onRsvp(ctx, ev, userId, data.p, data.v === '1' ? '行く' : data.v === '2' ? '保留' : '行かない');
    case 'confirm':
      return onConfirm(ctx, ev, userId, data.d, data.r === '1');
    case 'discard': {
      const draft = loadDraft(ctx, data.d);
      if (draft && draft.booker === userId) removeDraft(ctx, data.d);
      safeReply(ctx, ev, [textMsg('取り消しました。')]);
      return;
    }
  }
}

function onRsvp(ctx: Ctx, ev: LineEvent, userId: string, practiceId: string, answer: Answer): void {
  const groupId = ev.source.groupId;
  const member = ensureMember(ctx, userId, { groupId });
  const res = recordAnswer(
    ctx,
    practiceId,
    { participant: userId, name: member.name, kind: 'メンバー', via: 'ボタン', addedBy: userId },
    answer,
  );
  // 記録できたときは本人の発言（displayText）が出るので返信しない
  if (!res.ok) {
    const p = ctx.store.getPractice(practiceId);
    safeReply(ctx, ev, [textMsg(p ? `${shortDate(p.date)}の練習は${res.reason}` : res.reason)]);
  }
}

/** 確認カードの「登録のみ」（recruit=false）。以前のカードの「登録する」「登録してグループに募集」（recruit=true）もここに来る */
function onConfirm(ctx: Ctx, ev: LineEvent, userId: string, draftId: string, recruit: boolean): void {
  const draft = loadDraft(ctx, draftId);
  if (!draft || draft.booker !== userId) {
    safeReply(ctx, ev, [textMsg('この確認カードは期限切れか、処理済みです。もう一度スクショを送ってください。')]);
    return;
  }
  const member = ctx.store.getMember(userId);
  if (!member) return;
  removeDraft(ctx, draftId); // 二度押しで二重に登録・募集しないよう先に消す
  const inputs: NewPracticeInput[] = draft.items.map((i) => ({ ...i.reservation, max: null, min: null, memo: '' }));
  const targetGroups = recruit ? draft.groups : [];
  let result;
  try {
    result = createPractices(ctx, member, inputs, targetGroups);
  } catch (e) {
    saveDraft(ctx, draft);
    throw e;
  }
  const groups = ctx.store.settings().groups;
  // 実際に募集を送れたグループ（確認カードを出したあとに外れたグループには送らない）
  const recruited = result.recruited ?? [];
  const lines: string[] = [];
  if (result.created.length) {
    lines.push(
      recruited.length
        ? `登録して募集しました（${recruited.map((g) => groups.find((x) => x.id === g)?.name ?? g).join('、')}）`
        : '登録しました',
    );
    for (const id of result.created) {
      const p = ctx.store.getPractice(id);
      if (p) lines.push(`・${labelDate(p.date)} ${p.start}〜${p.end} ${p.studio} ${p.room}`.trim());
    }
  }
  for (const id of result.extended) {
    const p = ctx.store.getPractice(id);
    if (p) lines.push(`${labelDate(p.date)}の練習を${p.end}までに延長しました。`);
  }
  if (result.skipped.length) lines.push(`登録済みの予約${result.skipped.length}件は飛ばしました。`);
  if (result.notRecruited?.length) {
    lines.push(`${result.notRecruited.map((g) => groups.find((x) => x.id === g)?.name ?? g).join('、')}には募集を送れませんでした。アプリの「募集」から送り直せます。`);
  }
  if (result.created.length && !recruited.length) {
    lines.push('', 'グループに募集するときは、アプリの「募集」で練習を開くと送れます。', ctx.config.appUrl);
  }
  safeReply(ctx, ev, [textMsg(lines.join('\n') || '登録する予約はありませんでした。')]);
}

// ---------------------------------------------------------------- グループ

function onJoin(ctx: Ctx, ev: LineEvent): void {
  const id = chatId(ev.source);
  if (!id || ev.source.type === 'user') return;
  let name = '';
  if (ev.source.groupId) {
    try {
      const summary = ctx.line.groupSummary(id);
      // 他の公式アカウントがいるトークなどでは、招待された直後にLINEがBotを外す。そのときは設定に載せない
      if (!summary) {
        ctx.log('joined but group not found', id);
        return;
      }
      name = summary.groupName ?? '';
    } catch (e) {
      ctx.log('group summary error', e);
    }
  }
  // 見つからないと数えていた途中で招待し直された場合は、数え直す
  ctx.kv.remove(goneKey(id));
  ctx.withLock(() => {
    const s = ctx.store.settings();
    if (!s.groups.some((g) => g.id === id)) {
      s.groups.push({ id, name: name || `グループ${s.groups.length + 1}`, key: ctx.uuid() });
      ctx.store.saveSettings(s);
    }
  });
  // 招待されたときの案内は送らない（グループの会話を邪魔しないため）
}

function onLeave(ctx: Ctx, ev: LineEvent): void {
  const id = chatId(ev.source);
  ctx.withLock(() => {
    const s = ctx.store.settings();
    s.groups = s.groups.filter((g) => g.id !== id);
    ctx.store.saveSettings(s);
  });
}
