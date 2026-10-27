import { beforeEach, describe, expect, it } from 'vitest';
import { handleApi } from '../src/app/api';
import { DEFAULT_FEES } from '@studio-attendance/shared';
import { INITIAL_SETTINGS, rowsToSettings, settingsToRows, toCell } from '../src/app/schema';
import { handleJoin } from '../src/app/join';
import { route } from '../src/app/router';
import { hourlyJob } from '../src/app/triggers';
import { handleWebhook, type LineEvent } from '../src/app/webhook';
import { makeTestCtx } from './fakes';

const BOOKER = 'Ubooker';
const ADMIN = 'Uadmin';
const G1 = 'Cgroup1';

function setup() {
  const t = makeTestCtx();
  t.store.m.push(
    { userId: ADMIN, name: 'おおゆち', role: '管理者', defaultGroups: [G1], groups: [G1] },
    { userId: BOOKER, name: '後輩', role: '予約者', defaultGroups: [G1], groups: [G1] },
  );
  t.store.s = {
    studios: [{ name: 'worcle横浜', aliases: [], rooms: [] }],
    fees: [{ studio: 'worcle', room: '', fee: 1500 }],
    cancelRules: [{ studio: 'worcle', daysBefore: 4, time: '10:00' }],
    minDefault: 3,
    roundUnit: 10,
    groups: [{ id: G1, name: 'チームA' }],
  };
  return t;
}

/** グループ1に入っている一般メンバーを足す */
const inG1 = (t: ReturnType<typeof setup>, userId: string, name: string) =>
  t.store.m.push({ userId, name, role: '一般', defaultGroups: [], groups: [G1] });

const imageEvent = (userId: string, id = 'm1', imageSet?: { id: string; index: number; total: number }): LineEvent => ({
  type: 'message',
  replyToken: `rt-${id}`,
  source: { type: 'user', userId },
  message: { id, type: 'image', imageSet },
});

const postback = (userId: string, data: string, groupId?: string): LineEvent => ({
  type: 'postback',
  replyToken: 'rt-pb',
  source: groupId ? { type: 'group', groupId, userId } : { type: 'user', userId },
  postback: { data },
});

const reservation = { date: '2026-10-21', start: '19:00', end: '21:00', studio: 'worcle横浜', room: 'A', fee: 6000 };
const PID = 'worcle横浜-20261021-1900-A';
const baseP = {
  id: 'old-1', date: '2026-09-01', start: '19:00', end: '21:00', studio: 'x', room: 'A', fee: 0, booker: BOOKER, max: null, min: null,
  memo: '', status: '終了', groups: [], joinKey: 'k', feeOverride: null, warned: true, createdAt: '',
};

describe('スクショから募集まで', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('一般メンバー（未登録の人も）スクショから登録できる。送り先はグループが1つならそこ', () => {
    t.reader.result = [reservation];
    t.line.profiles['Ustranger'] = 'はじめて';
    handleWebhook(t.ctx, { events: [imageEvent('Ustranger')] });
    expect(t.store.m.find((m) => m.userId === 'Ustranger')).toMatchObject({ name: 'はじめて', role: '一般' });
    const card = t.line.lastReplyText();
    expect(card).toContain('予約内容の確認');
    expect(card).toContain('チームA');
    expect(card).toContain('"label":"登録する"');
    expect(card).toContain('登録してグループに募集');
  });

  it('グループが複数でふだんの送り先が未設定なら、「登録する」だけ出す', () => {
    t.store.s.groups.push({ id: 'C2', name: 'チームB' });
    t.reader.result = [reservation];
    handleWebhook(t.ctx, { events: [imageEvent('Ustranger')] });
    expect(t.line.lastReplyText()).toContain('"label":"登録する"');
    expect(t.line.lastReplyText()).not.toContain('登録してグループに募集');
  });

  it('「登録する」は登録だけ。グループには流さず、あとから募集する方法を案内する', () => {
    t.reader.result = [reservation];
    handleWebhook(t.ctx, { events: [imageEvent(BOOKER)] });
    const draftId = [...t.kv.data.keys()][0].replace('draft:', '');
    handleWebhook(t.ctx, { events: [postback(BOOKER, `a=confirm&d=${draftId}`)] });
    expect(t.store.p).toMatchObject([{ id: PID, groups: [] }]);
    expect(t.line.pushes).toHaveLength(0);
    expect(t.line.lastReplyText()).toContain('登録しました');
    expect(t.line.lastReplyText()).toContain('グループに募集');
  });

  it('読み取りで例外が起きたら、エラーだと伝える', () => {
    t.reader.read = () => {
      throw new Error('Gemini 404: model not found');
    };
    handleWebhook(t.ctx, { events: [imageEvent(BOOKER)] });
    expect(t.line.lastReplyText()).toContain('読み取りでエラーが起きました');
    expect(() => handleApi(t.ctx, { userId: BOOKER }, 'parseReservations', { images: [{ mimeType: 'image/jpeg', data: 'x' }] })).toThrow(
      'Gemini 404: model not found',
    );
  });

  it('確認カード → 登録してグループに募集 → グループに募集が1メッセージで流れる', () => {
    t.reader.result = [reservation, { ...reservation, date: '2026-10-22' }];
    handleWebhook(t.ctx, { events: [imageEvent(BOOKER)] });
    const card = t.line.lastReplyText();
    expect(card).toContain('予約内容の確認');
    expect(card).toContain('チームA');
    const draftId = [...t.kv.data.keys()][0].replace('draft:', '');

    handleWebhook(t.ctx, { events: [postback(BOOKER, `a=confirm&d=${draftId}&r=1`)] });
    expect(t.store.p.map((p) => p.id)).toEqual([PID, 'worcle横浜-20261022-1900-A']);
    expect(t.line.pushes).toHaveLength(1);
    expect(t.line.pushes[0].to).toBe(G1);
    expect(t.line.pushes[0].messages).toHaveLength(1);
    expect(t.line.lastReplyText()).toContain('登録して募集しました（チームA）');

    // 二度押ししても二重に募集しない
    handleWebhook(t.ctx, { events: [postback(BOOKER, `a=confirm&d=${draftId}&r=1`)] });
    expect(t.line.pushes).toHaveLength(1);
    expect(t.line.lastReplyText()).toContain('期限切れか、処理済み');
  });

  it('同じ予約をもう一度送っても募集しない／延長は既存を更新', () => {
    t.reader.result = [reservation];
    handleWebhook(t.ctx, { events: [imageEvent(BOOKER, 'm1')] });
    let draftId = [...t.kv.data.keys()].at(-1)!.replace('draft:', '');
    handleWebhook(t.ctx, { events: [postback(BOOKER, `a=confirm&d=${draftId}&r=1`)] });

    t.reader.result = [reservation, { ...reservation, start: '21:00', end: '22:00', fee: 3000 }];
    handleWebhook(t.ctx, { events: [imageEvent(BOOKER, 'm2')] });
    const card = t.line.lastReplyText();
    expect(card).not.toContain('10/21(水) 19:00');
    expect(card).toContain('登録済みの予約1件は除きました');
    expect(card).toContain('延長として更新');
    draftId = [...t.kv.data.keys()].at(-1)!.replace('draft:', '');
    handleWebhook(t.ctx, { events: [postback(BOOKER, `a=confirm&d=${draftId}`)] });
    expect(t.store.p).toHaveLength(1);
    expect(t.store.p[0]).toMatchObject({ end: '22:00', fee: 9000 });
    expect(t.line.pushes).toHaveLength(1);
    expect(t.line.lastReplyText()).toContain('22:00までに延長');
  });

  it('料金が読めなければ標準料金（1時間あたり × 時間）、必須項目が欠けたら登録ボタンを出さない', () => {
    t.reader.result = [{ ...reservation, fee: null }, { date: '2026-10-23', start: null, end: null, studio: 'worcle横浜', room: 'B', fee: null }];
    handleWebhook(t.ctx, { events: [imageEvent(BOOKER)] });
    const card = t.line.lastReplyText();
    expect(card).toContain('¥6,000');
    expect(card).toContain('読み取れなかった項目がある予約が1件');
    expect(card).not.toContain('"label":"登録する"');
  });

  it('複数枚送信はそろってからまとめて読み取る', () => {
    t.reader.result = [reservation];
    handleWebhook(t.ctx, { events: [imageEvent(BOOKER, 'm2', { id: 's', index: 2, total: 2 })] });
    expect(t.reader.calls).toHaveLength(0);
    handleWebhook(t.ctx, { events: [imageEvent(BOOKER, 'm1', { id: 's', index: 1, total: 2 })] });
    expect(t.reader.calls[0].input.images.map((i) => i.data)).toEqual(['m1', 'm2']);
  });

  it('予約一覧のスクショ: 過去の予約は除き、同じ部屋で続く予約は1件にまとめる', () => {
    t.clock.now = new Date('2026-10-14T00:00:00Z'); // 10/14 9:00
    t.reader.result = [
      { date: '2026-10-13', start: '19:00', end: '21:00', studio: '横浜', room: '301', fee: 3200 },
      { date: '2026-10-14', start: '19:00', end: '20:30', studio: '横浜', room: '301', fee: 2400 },
      { date: '2026-10-14', start: '20:30', end: '21:00', studio: '横浜', room: '301', fee: 800 },
      { date: '2026-10-21', start: '19:30', end: '21:00', studio: '横浜', room: '202', fee: 3300 },
    ];
    handleWebhook(t.ctx, { events: [imageEvent(BOOKER)] });
    const card = t.line.lastReplyText();
    expect(card).toContain('10/14(水) 19:00〜21:00');
    expect(card).toContain('¥3,200');
    expect(card).toContain('10/21(水) 19:30〜21:00');
    expect(card).toContain('終了した予約1件は除きました');
    expect(card).not.toContain('20:30');
  });

  it('登録済み・終了した予約だけなら確認カードを出さず、件数を伝える', () => {
    t.reader.result = [reservation];
    handleWebhook(t.ctx, { events: [imageEvent(BOOKER, 'm1')] });
    const draftId = [...t.kv.data.keys()].at(-1)!.replace('draft:', '');
    handleWebhook(t.ctx, { events: [postback(BOOKER, `a=confirm&d=${draftId}`)] });

    t.clock.now = new Date('2026-10-21T09:30:00Z'); // 10/21 18:30（同じ日の 17:00〜18:00 はもう終わっている）
    const drafts = t.kv.data.size;
    t.reader.result = [
      { date: '2026-10-21', start: '17:00', end: '18:00', studio: 'worcle横浜', room: 'B', fee: 1000 },
      { date: '2026-10-21', start: '19:00', end: '21:00', studio: 'worcle横浜', room: 'A', fee: 6000 },
    ];
    handleWebhook(t.ctx, { events: [imageEvent(BOOKER, 'm2')] });
    expect(t.line.lastReplyText()).toContain('新しく登録する予約はありませんでした。登録済みの予約1件・終了した予約1件は除きました。');
    expect(t.kv.data.size).toBe(drafts);

    // アプリの読み取りも同じ
    const r = handleApi(t.ctx, { userId: BOOKER }, 'parseReservations', { text: '10/21' }) as any;
    expect(r).toMatchObject({ items: [], pastCount: 1, duplicateCount: 1 });
  });

  it('スタジオの一覧と、これまでに登録された一覧外のスタジオを読み取りの手がかりとして渡す', () => {
    t.store.p.push({ ...JSON.parse(JSON.stringify(baseP)), studio: '市民センター' });
    t.reader.result = [reservation];
    handleWebhook(t.ctx, { events: [imageEvent(BOOKER)] });
    expect(t.reader.calls[0].hints.studios.map((s) => s.name)).toEqual(['worcle横浜', '市民センター']);
    expect(t.reader.calls[0].hints.today).toBe('2026-10-10');
  });

  it('個別トークの文章から予約を読み取る／関係ない文章には使い方を返す／グループでは反応しない', () => {
    const text = (s: string, group = false): LineEvent => ({
      type: 'message',
      replyToken: 'rt',
      source: group ? { type: 'group', groupId: G1, userId: BOOKER } : { type: 'user', userId: BOOKER },
      message: { id: 'x', type: 'text', text: s },
    });
    t.reader.result = [reservation];
    handleWebhook(t.ctx, { events: [text('2026-10-21(水) 19:00〜21:00 横浜 A ¥6,000')] });
    expect(t.reader.calls[0].input).toEqual({ images: [], text: '2026-10-21(水) 19:00〜21:00 横浜 A ¥6,000' });
    expect(t.line.lastReplyText()).toContain('予約内容の確認');

    handleWebhook(t.ctx, { events: [text('こんにちは')] });
    expect(t.line.lastReplyText()).toContain('予約内容の文章');
    expect(t.reader.calls).toHaveLength(1);

    const before = t.line.replies.length;
    handleWebhook(t.ctx, { events: [text('10/21 19:00からでいい？', true)] });
    expect(t.line.replies).toHaveLength(before);
    expect(t.reader.calls).toHaveLength(1);
  });

  it('アプリ: 文章を貼り付けて読み取る', () => {
    t.reader.result = [reservation];
    const r = handleApi(t.ctx, { userId: BOOKER }, 'parseReservations', { text: '10/21 19:00-21:00' }) as any;
    expect(r).toMatchObject({ pastCount: 0, items: [{ kind: 'new' }] });
    expect(() => handleApi(t.ctx, { userId: BOOKER }, 'parseReservations', {})).toThrow('スクショを選ぶか');
  });

  it('読み取ったスタジオ名・部屋名を一覧の正式な名前にそろえる', () => {
    t.store.s.studios = [
      { name: 'BUZZ横浜', aliases: [], rooms: [{ name: '1スタジオ', size: '46.5㎡' }] },
      { name: 'studio worcle 横浜', aliases: ['わーくる横浜'], rooms: [{ name: '301', size: '約20㎡' }] },
    ];
    t.reader.result = [
      { date: '2026-10-21', start: '19:00', end: '21:00', studio: '横浜', room: '301', fee: 2400 },
      { date: '2026-10-22', start: '19:00', end: '21:00', studio: 'BUZZ 横浜', room: 'スタジオ1', fee: 2600 },
    ];
    handleWebhook(t.ctx, { events: [imageEvent(BOOKER)] });
    const card = t.line.lastReplyText();
    expect(card).toContain('studio worcle 横浜 301');
    expect(card).toContain('BUZZ横浜 1スタジオ');
  });

  it('応答が間に合わなければプッシュで確認カードを送る', () => {
    t.reader.result = [reservation];
    t.line.failReply = true;
    handleWebhook(t.ctx, { events: [imageEvent(BOOKER)] });
    expect(t.line.pushes[0].to).toBe(BOOKER);
  });
});

describe('出欠', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
    t.reader.result = [reservation];
    handleWebhook(t.ctx, { events: [imageEvent(BOOKER)] });
    const draftId = [...t.kv.data.keys()][0].replace('draft:', '');
    handleWebhook(t.ctx, { events: [postback(BOOKER, `a=confirm&d=${draftId}&r=1`)] });
    t.line.replies = [];
    // 登録者の自動「行く」は別のテストで確かめるので、ここでは出欠を空にしておく
    t.store.a = [];
  });

  it('登録した人は自動で「行く」になる', () => {
    const t2 = setup();
    t2.reader.result = [reservation];
    handleWebhook(t2.ctx, { events: [imageEvent(BOOKER)] });
    handleWebhook(t2.ctx, { events: [postback(BOOKER, `a=confirm&d=${[...t2.kv.data.keys()][0].replace('draft:', '')}`)] });
    expect(t2.store.a).toMatchObject([{ practiceId: PID, participant: BOOKER, answer: '行く', kind: 'メンバー' }]);
    expect(t2.line.loadings).toEqual([BOOKER]); // 読み取り中は「入力中…」を出す
  });

  it('「保留」も選べる。人数（割り勘・上限）には数えない', () => {
    t.store.p[0].max = 1;
    inG1(t, 'U2', 'に');
    handleWebhook(t.ctx, { events: [postback('U1', `a=rsvp&p=${encodeURIComponent(PID)}&v=2`, G1)] });
    expect(t.store.a).toMatchObject([{ participant: 'U1', answer: '保留' }]);
    const v = handleApi(t.ctx, { userId: 'U2', name: 'に' }, 'rsvp', { id: PID, answer: '行く' }) as any;
    expect(v.goingCount).toBe(1);
    expect(v.maybe.map((a: any) => a.participant)).toEqual(['U1']);
    expect(t.store.p[0].status).toBe('満員');
    expect(() => handleApi(t.ctx, { userId: 'U2' }, 'rsvp', { id: PID, answer: 'たぶん' })).toThrow('回答が不正');
  });

  it('練習は、登録した本人と管理者だけ削除できる', () => {
    const item = { ...reservation, date: '2026-10-30', max: null, min: null, memo: '' };
    const { created } = handleApi(t.ctx, { userId: 'U9', name: 'きゅう' }, 'createPractices', { items: [item], groups: [] }) as any;
    expect(() => handleApi(t.ctx, { userId: 'U1', name: 'いち' }, 'deletePractice', { id: created[0] })).toThrow('予約者か管理者');
    const list = handleApi(t.ctx, { userId: 'U9' }, 'deletePractice', { id: created[0] }) as any[];
    expect(list.map((v) => v.practice.id)).not.toContain(created[0]);
    expect(t.store.a.filter((a) => a.practiceId === created[0])).toEqual([]);
    // 募集を流していない練習は、どのグループにも連絡しない
    expect(t.line.pushes.filter((p) => JSON.stringify(p).includes('【中止】'))).toEqual([]);
  });

  it('募集を流した練習も削除でき、グループには何も送らない', () => {
    t.store.s.groups.push({ id: 'C2', name: 'チームB' });
    handleApi(t.ctx, { userId: BOOKER }, 'recruitPractice', { id: PID, groups: ['C2'] });
    const pushes = t.line.pushes.length;
    const list = handleApi(t.ctx, { userId: ADMIN }, 'deletePractice', { id: PID }) as any[];
    expect(list.map((v) => v.practice.id)).not.toContain(PID);
    expect(t.line.pushes).toHaveLength(pushes);
    expect(t.store.a.filter((a) => a.practiceId === PID)).toEqual([]);
  });

  it('アプリから登録すると、取り直さなくてよいよう登録後の一覧も返す', () => {
    const item = { ...reservation, date: '2026-10-31', max: null, min: null, memo: '' };
    const res = handleApi(t.ctx, { userId: BOOKER }, 'createPractices', { items: [item], groups: [] }) as any;
    expect(res.practices.map((v: any) => v.practice.id)).toContain(res.created[0]);
    expect(res.practices.find((v: any) => v.practice.id === res.created[0]).myAnswer).toBe('行く');
  });

  it('ボタンで記録し、知らない人はメンバー登録。成功時は返信しない', () => {
    t.line.profiles['Unew'] = 'たろう';
    handleWebhook(t.ctx, { events: [postback('Unew', `a=rsvp&p=${encodeURIComponent(PID)}&v=1`, G1)] });
    expect(t.store.a).toMatchObject([{ participant: 'Unew', answer: '行く', via: 'ボタン', kind: 'メンバー' }]);
    expect(t.store.m.find((m) => m.userId === 'Unew')?.name).toBe('たろう');
    expect(t.line.replies).toHaveLength(0);
    handleWebhook(t.ctx, { events: [postback('Unew', `a=rsvp&p=${encodeURIComponent(PID)}&v=0`, G1)] });
    expect(t.store.a).toMatchObject([{ participant: 'Unew', answer: '行かない' }]);
  });

  it('上限に達したら満員、（以前の）中止の練習なら断る', () => {
    t.store.p[0].max = 1;
    handleWebhook(t.ctx, { events: [postback('U1', `a=rsvp&p=${encodeURIComponent(PID)}&v=1`, G1)] });
    expect(t.store.p[0].status).toBe('満員');
    handleWebhook(t.ctx, { events: [postback('U2', `a=rsvp&p=${encodeURIComponent(PID)}&v=1`, G1)] });
    expect(t.line.lastReplyText()).toContain('10/21の練習は満員です');
    handleWebhook(t.ctx, { events: [postback('U1', `a=rsvp&p=${encodeURIComponent(PID)}&v=0`, G1)] });
    expect(t.store.p[0].status).toBe('募集中');

    t.store.p[0].status = '中止';
    handleWebhook(t.ctx, { events: [postback('U2', `a=rsvp&p=${encodeURIComponent(PID)}&v=1`, G1)] });
    expect(t.line.lastReplyText()).toContain('中止になりました');
  });

  it('「練習」に完全一致で一覧を返す', () => {
    const text = (s: string): LineEvent => ({ type: 'message', replyToken: 'rt', source: { type: 'group', groupId: G1, userId: 'U1' }, message: { id: 'x', type: 'text', text: s } });
    handleWebhook(t.ctx, { events: [text('練習お疲れ')] });
    expect(t.line.replies).toHaveLength(0);
    handleWebhook(t.ctx, { events: [text('練習')] });
    expect(t.line.lastReplyText()).toContain('今後の練習');
    expect(t.line.lastReplyText()).toContain('10/21(水)');
  });

  it('アプリ: 割り勘・ゲスト・権限', () => {
    inG1(t, 'U1', 'いち');
    handleApi(t.ctx, { userId: 'U1', name: 'いち' }, 'rsvp', { id: PID, answer: '行く' });
    const v = handleApi(t.ctx, { userId: 'U1' }, 'addGuest', { id: PID, name: 'ゲストさん' }) as any;
    expect(v.goingCount).toBe(2);
    expect(v.perPerson).toBe(3000);
    const guest = v.going.find((g: any) => g.kind === 'ゲスト');
    expect(guest).toMatchObject({ name: 'ゲストさん', addedByName: 'いち', canRemove: true });
    expect(v.canEdit).toBe(false);
    expect(v.joinUrl).toBe(`https://pages.example/join.html?p=${encodeURIComponent(PID)}&k=uuid2`);

    // 他人の練習は削除できない、追加していないゲストは消せない
    expect(() => handleApi(t.ctx, { userId: 'U1' }, 'deletePractice', { id: PID })).toThrow('予約者か管理者');
    expect(() => handleApi(t.ctx, { userId: 'U3', name: 'さん' }, 'removeAttendance', { id: PID, participant: guest.participant })).toThrow();
    // 予約者は消せる、金額調整ができる
    handleApi(t.ctx, { userId: BOOKER }, 'removeAttendance', { id: PID, participant: guest.participant });
    const v2 = handleApi(t.ctx, { userId: BOOKER }, 'updatePractice', { id: PID, patch: { feeOverride: 2500 } }) as any;
    expect(v2.goingCount).toBe(1);
    expect(v2.perPerson).toBe(2500);
  });

  it('参加リンク: 合言葉が合うときだけ、同じ端末は回答を更新', () => {
    const key = t.store.p[0].joinKey;
    expect(() => handleJoin(t.ctx, 'get', { id: PID, key: 'wrong' })).toThrow('無効');
    const r1 = handleJoin(t.ctx, 'answer', { id: PID, key, name: 'はなこ', answer: '行く' }) as any;
    expect(r1.goingCount).toBe(1);
    const r2 = handleJoin(t.ctx, 'answer', { id: PID, key, name: 'はなこ', answer: '行かない', participant: r1.participant }) as any;
    expect(r2.goingCount).toBe(0);
    expect(r2.myAnswer).toBe('行かない');
    expect(t.store.a).toHaveLength(1);
  });

  it('アプリから手動登録（送り先なしなら登録だけ、一般メンバーも登録でき予約者になる）', () => {
    const item = { ...reservation, date: '2026-10-30', fee: null, max: 8, min: null, memo: 'ショーケースの通し' };
    const pushes = t.line.pushes.length;
    const only = handleApi(t.ctx, { userId: 'U9', name: 'きゅう' }, 'createPractices', { items: [item], groups: [] }) as any;
    expect(only.created).toHaveLength(1);
    expect(t.line.pushes).toHaveLength(pushes);
    expect(t.store.getPractice(only.created[0])).toMatchObject({ fee: 6000, max: 8, memo: 'ショーケースの通し', booker: 'U9', groups: [] });
    // 登録した本人は修正・中止ができ、他の一般メンバーはできない
    expect((handleApi(t.ctx, { userId: 'U9' }, 'getPractice', { id: only.created[0] }) as any).canEdit).toBe(true);
    // どこにも募集していない練習は、他の一般メンバーには見えない
    expect(() => handleApi(t.ctx, { userId: 'U1', name: 'いち' }, 'getPractice', { id: only.created[0] })).toThrow('練習が見つかりません');

    const withGroup = handleApi(t.ctx, { userId: 'U9' }, 'createPractices', { items: [{ ...item, date: '2026-10-31' }], groups: [G1] }) as any;
    expect(t.store.getPractice(withGroup.created[0])?.groups).toEqual([G1]);
    expect(t.line.pushes).toHaveLength(pushes + 1);
  });

  it('あとからグループに募集できる。同じグループには二重に流さない。登録した本人と管理者だけ', () => {
    t.store.s.groups.push({ id: 'C2', name: 'チームB' });
    const item = { ...reservation, date: '2026-10-30', max: null, min: null, memo: '' };
    const { created } = handleApi(t.ctx, { userId: 'U9', name: 'きゅう' }, 'createPractices', { items: [item], groups: [] }) as any;
    const id = created[0];
    expect(() => handleApi(t.ctx, { userId: 'U1', name: 'いち' }, 'recruitPractice', { id, groups: [G1] })).toThrow('予約者か管理者');
    const pushes = t.line.pushes.length;
    const v = handleApi(t.ctx, { userId: 'U9' }, 'recruitPractice', { id, groups: [G1] }) as any;
    expect(v.groupNames).toEqual(['チームA']);
    expect(t.line.pushes.slice(pushes).map((p) => p.to)).toEqual([G1]);
    expect(() => handleApi(t.ctx, { userId: 'U9' }, 'recruitPractice', { id, groups: [G1] })).toThrow('グループを選んで');
    handleApi(t.ctx, { userId: ADMIN }, 'recruitPractice', { id, groups: [G1, 'C2'] });
    expect(t.line.pushes.slice(pushes).map((p) => p.to)).toEqual([G1, 'C2']);
    expect(t.store.getPractice(id)?.groups).toEqual([G1, 'C2']);
  });
});

describe('改善要望', () => {
  it('誰でも投稿できるが、一覧を見て状態とコメントを付けられるのは管理者だけ', () => {
    const t = setup();
    expect(handleApi(t.ctx, { userId: 'U1', name: 'いち' }, 'postFeedback', { text: '  前日にリマインドがほしい  ' })).toEqual([]);
    expect(handleApi(t.ctx, { userId: BOOKER }, 'listFeedback', {})).toEqual([]);
    expect(handleApi(t.ctx, { userId: 'U1' }, 'listFeedback', {})).toEqual([]);
    const list = handleApi(t.ctx, { userId: ADMIN }, 'listFeedback', {}) as any[];
    expect(list).toMatchObject([{ name: 'いち', text: '前日にリマインドがほしい', status: '未対応', mine: false, canDelete: true }]);
    expect(() => handleApi(t.ctx, { userId: 'U1' }, 'postFeedback', { text: ' ' })).toThrow('入力');

    expect(() => handleApi(t.ctx, { userId: 'U1' }, 'updateFeedback', { id: list[0].id, status: '対応済み' })).toThrow('管理者');
    const updated = handleApi(t.ctx, { userId: ADMIN }, 'updateFeedback', { id: list[0].id, status: '検討中', reply: '検討します' }) as any[];
    expect(updated[0]).toMatchObject({ status: '検討中', reply: '検討します', canDelete: true });

    expect(() => handleApi(t.ctx, { userId: BOOKER }, 'deleteFeedback', { id: list[0].id })).toThrow('本人か管理者');
    expect(handleApi(t.ctx, { userId: 'U1' }, 'deleteFeedback', { id: list[0].id })).toEqual([]);
  });
});

describe('キャンセル期限前警告と終了', () => {
  it('期限を過ぎて人数が足りなければ予約者に1回だけ知らせる', () => {
    const t = setup();
    t.reader.result = [reservation];
    handleWebhook(t.ctx, { events: [imageEvent(BOOKER)] });
    handleWebhook(t.ctx, { events: [postback(BOOKER, `a=confirm&d=${[...t.kv.data.keys()][0].replace('draft:', '')}`)] });
    t.line.pushes = [];

    t.clock.now = new Date('2026-10-17T00:59:00Z'); // 10/17 9:59 JST
    hourlyJob(t.ctx);
    expect(t.line.pushes).toHaveLength(0);

    t.clock.now = new Date('2026-10-17T01:00:00Z');
    hourlyJob(t.ctx);
    expect(t.line.pushes).toHaveLength(1);
    expect(t.line.pushes[0].to).toBe(BOOKER);
    expect(JSON.stringify(t.line.pushes[0])).toContain('現在1人です（最低人数3人）'); // 登録者が自動で「行く」
    hourlyJob(t.ctx);
    expect(t.line.pushes).toHaveLength(1);

    t.clock.now = new Date('2026-10-22T00:00:00Z');
    hourlyJob(t.ctx);
    expect(t.store.p[0].status).toBe('終了');
  });

  it('警告時刻を過ぎてから入った予約には出さない', () => {
    const t = setup();
    t.clock.now = new Date('2026-10-18T00:00:00Z');
    handleApi(t.ctx, { userId: BOOKER }, 'createPractices', {
      items: [{ ...reservation, max: null, min: null, memo: '' }],
      groups: [G1],
    });
    t.line.pushes = [];
    hourlyJob(t.ctx);
    expect(t.line.pushes).toHaveLength(0);
    expect(t.store.p[0].warned).toBe(true);
  });
});

describe('ルーター', () => {
  const verify = {
    relay: (_ts: number, _b: string, mac: string) => mac === 'good',
    idToken: (tok: string) => (tok === 'valid' ? { userId: ADMIN } : null),
  };

  it('中継署名と時刻を確かめる', () => {
    const t = setup();
    const ts = t.ctx.now().getTime();
    expect(route(t.ctx, JSON.stringify({ kind: 'line', ts, body: '{"events":[]}', mac: 'bad' }), verify)).toEqual({ ok: false, error: 'forbidden' });
    expect(route(t.ctx, JSON.stringify({ kind: 'line', ts: ts - 10 * 60 * 1000, body: '{"events":[]}', mac: 'good' }), verify).ok).toBe(false);
    expect(route(t.ctx, JSON.stringify({ kind: 'line', ts, body: '{"events":[]}', mac: 'good' }), verify).ok).toBe(true);
  });

  it('IDトークンが無効ならアプリの操作を受け付けない', () => {
    const t = setup();
    expect(route(t.ctx, JSON.stringify({ kind: 'api', idToken: 'x', action: 'me' }), verify).ok).toBe(false);
    const res = route(t.ctx, JSON.stringify({ kind: 'api', idToken: 'valid', action: 'me' }), verify);
    expect(res.ok && (res.data as any).member.role).toBe('管理者');
  });

  it('Botのグループ参加で設定にグループが載る', () => {
    const t = setup();
    handleWebhook(t.ctx, { events: [{ type: 'join', replyToken: 'rt', source: { type: 'group', groupId: 'Cnew' } }] });
    expect(t.store.s.groups.find((g) => g.id === 'Cnew')?.name).toBe('名前-Cnew');
  });

  it('毎時の処理でグループ名をLINE側の名前にそろえる', () => {
    const t = setup();
    t.store.s.groups.push({ id: 'Cfail', name: '旧名' }, { id: 'Cgone', name: '消えた' }, { id: 'Rroom', name: 'グループ3' });
    t.line.groupNames = { [G1]: ' チームA① ', Cfail: new Error('500'), Cgone: null };
    hourlyJob(t.ctx);
    expect(t.store.s.groups).toEqual([
      { id: G1, name: 'チームA①' }, // 前後の空白は除く
      { id: 'Cfail', name: '旧名' }, // 取得できなければそのまま
      { id: 'Cgone', name: '消えた' },
      { id: 'Rroom', name: 'グループ3' }, // 複数人トークは対象外
    ]);
  });

  it('Botが入っていないグループは、見つからないことが3回続いたら設定から外す', () => {
    const t = setup();
    t.store.s.groups.push({ id: 'Cgone', name: 'グループ2' }, { id: 'Cflaky', name: '不安定' });
    t.line.groupNames = { Cgone: null, Cflaky: new Error('500') };
    hourlyJob(t.ctx);
    hourlyJob(t.ctx);
    expect(t.store.s.groups.map((g) => g.id)).toEqual([G1, 'Cgone', 'Cflaky']);
    hourlyJob(t.ctx);
    // 通信エラーは数えない
    expect(t.store.s.groups.map((g) => g.id)).toEqual([G1, 'Cflaky']);
  });

  it('途中で名前を取得できたら、見つからなかった回数を数え直す', () => {
    const t = setup();
    t.store.s.groups.push({ id: 'Cback', name: '戻った' });
    t.line.groupNames = { Cback: null };
    hourlyJob(t.ctx);
    hourlyJob(t.ctx);
    t.line.groupNames = { Cback: '戻った' };
    hourlyJob(t.ctx);
    t.line.groupNames = { Cback: null };
    hourlyJob(t.ctx);
    hourlyJob(t.ctx);
    expect(t.store.s.groups.map((g) => g.id)).toContain('Cback');
  });

  it('外したあとは数えた回数も消え、通信エラーは何回続いても外さない', () => {
    const t = setup();
    t.store.s.groups.push({ id: 'Cgone', name: 'グループ2' }, { id: 'Cflaky', name: '不安定' }, { id: 'Rroom', name: 'グループ4' });
    t.line.groupNames = { Cgone: null, Cflaky: new Error('500') };
    for (let i = 0; i < 6; i++) hourlyJob(t.ctx);
    expect(t.store.s.groups.map((g) => g.id)).toEqual([G1, 'Cflaky', 'Rroom']);
    expect([...t.kv.data.keys()].filter((k) => k.startsWith('groupgone:'))).toEqual([]);
  });

  it('確かめたグループが全部見つからないときは、トークンの設定ミスを疑って外さない', () => {
    const t = setup();
    t.store.s.groups.push({ id: 'C2', name: 'チームB' });
    t.line.groupNames = { [G1]: null, C2: null };
    for (let i = 0; i < 4; i++) hourlyJob(t.ctx);
    expect(t.store.s.groups.map((g) => g.id)).toEqual([G1, 'C2']);
  });

  it('招待した時点でBotが外れていたグループは設定に載せない', () => {
    const t = setup();
    t.line.groupNames = { Cother: null };
    handleWebhook(t.ctx, { events: [{ type: 'join', replyToken: 'rt', source: { type: 'group', groupId: 'Cother' } }] });
    expect(t.store.s.groups.map((g) => g.id)).toEqual([G1]);
    expect(t.line.replies).toHaveLength(0);
  });

  it('見つからないと数えている途中で招待し直されたら数え直す', () => {
    const t = setup();
    t.store.s.groups.push({ id: 'Cback', name: '戻った' });
    t.line.groupNames = { Cback: null };
    hourlyJob(t.ctx);
    hourlyJob(t.ctx);
    t.line.groupNames = {};
    handleWebhook(t.ctx, { events: [{ type: 'join', replyToken: 'rt', source: { type: 'group', groupId: 'Cback' } }] });
    t.line.groupNames = { Cback: null };
    hourlyJob(t.ctx);
    expect(t.store.s.groups.map((g) => g.id)).toContain('Cback');
  });

  it('確認カードのあとで送り先のグループが外れたら「募集しました」と言わない', () => {
    const t = setup();
    t.reader.result = [reservation];
    handleWebhook(t.ctx, { events: [imageEvent(BOOKER)] });
    const draftId = [...t.kv.data.keys()][0].replace('draft:', '');
    t.store.s.groups = [];
    handleWebhook(t.ctx, { events: [postback(BOOKER, `a=confirm&d=${draftId}&r=1`)] });
    expect(t.line.pushes).toHaveLength(0);
    expect(t.line.lastReplyText()).not.toContain('募集しました');
    expect(t.line.lastReplyText()).toContain('アプリの「募集」');
  });

  it('グループ名が変わっていなければ設定を書き直さない', () => {
    const t = setup();
    t.line.groupNames = { [G1]: 'チームA ' };
    let saves = 0;
    const save = t.store.saveSettings.bind(t.store);
    t.store.saveSettings = (s) => {
      saves++;
      save(s);
    };
    hourlyJob(t.ctx);
    expect(saves).toBe(0);
  });

  it('グループ名の同期に失敗しても、終了処理と警告は済ませる', () => {
    const t = setup();
    t.store.p.push({ ...baseP, id: 'past', status: '募集中', warned: false } as any);
    t.line.groupNames = { [G1]: '新しい名前' };
    t.store.saveSettings = () => {
      throw new Error('sheet error');
    };
    expect(() => hourlyJob(t.ctx)).not.toThrow();
    expect(t.store.p.find((p) => p.id === 'past')?.status).toBe('終了');
  });
});

describe('リッチメニュー', () => {
  it('4つのボタンが横に並び、それぞれアプリの画面を開く', async () => {
    const { richMenuDefinition } = await import('../src/app/richmenu');
    const def = richMenuDefinition('https://liff.line.me/APP');
    expect(def.size).toEqual({ width: 2500, height: 843 });
    expect(def.areas.map((a) => a.action.uri)).toEqual([
      'https://liff.line.me/APP?view=register',
      'https://liff.line.me/APP?view=recruit',
      'https://liff.line.me/APP?view=mine',
      'https://liff.line.me/APP?view=feedback',
    ]);
    expect(def.areas.reduce((sum, a) => sum + a.bounds.width, 0)).toBe(2500);
  });
});

describe('設定シート', () => {
  it('シートに書く値は先頭に \' を付け、Sheets が外したあとに元の値へ戻る', () => {
    // 実機の Sheets は書いた値の先頭の ' を1つ外して、文字列として保存する
    const sheets = (v: string) => v.replace(/^'/, '');
    for (const v of ['=1+1', "'=x", "''=x", "'-'", "'x", '-5', '+81 90', '@here', '0123', '2026-10-21', '19:00', 'チームA']) {
      expect(toCell(v).startsWith("'")).toBe(true);
      expect(sheets(toCell(v))).toBe(v);
    }
    expect(toCell('')).toBe('');
  });

  it('標準料金は曜日・時間帯つきで書き戻せる。0円の行しかなければ公式の料金表を使う', () => {
    const rows = settingsToRows({ ...INITIAL_SETTINGS, groups: [] });
    expect(rows).toContainEqual({ 種別: '標準料金', キー1: 'BUZZ横浜', キー2: '1スタジオ', 値: '平日 17:00-23:30 1300' });
    expect(rowsToSettings(rows).fees).toEqual(DEFAULT_FEES);

    const zero = rowsToSettings([{ 種別: '標準料金', キー1: 'worcle', キー2: '', 値: '0' }]);
    expect(zero.fees).toEqual(DEFAULT_FEES);
    const custom = rowsToSettings([{ 種別: '標準料金', キー1: 'worcle', キー2: '', 値: '1000' }]);
    expect(custom.fees).toEqual([{ studio: 'worcle', room: '', days: '', from: '', to: '', fee: 1000 }]);
  });
});

describe('見える練習', () => {
  const G2 = 'Cgroup2';
  let t: ReturnType<typeof setup>;
  const member = (userId: string, groups: string[]) => t.store.m.push({ userId, name: userId, role: '一般', defaultGroups: [], groups });
  const ids = (userId: string) => (handleApi(t.ctx, { userId }, 'listPractices', {}) as any[]).map((v) => v.practice.id);
  const item = { ...reservation, date: '2026-10-30', max: null, min: null, memo: '' };
  const groupEvent = (type: string, groupId: string, extra: Partial<LineEvent> = {}): LineEvent => ({ type, source: { type: 'group', groupId }, ...extra });

  beforeEach(() => {
    t = setup();
    t.store.s.groups.push({ id: G2, name: 'チームB' });
    // グループ1に B・C、グループ2に C・D がいる。予約者（A）は両方に入っている
    t.store.m.find((m) => m.userId === BOOKER)!.groups = [G1, G2];
    member('UB', [G1]);
    member('UC', [G1, G2]);
    member('UD', [G2]);
  });

  it('グループ1にだけ募集した練習は、グループ2にしかいない人には見えない。あとでグループ2にも流すと見える', () => {
    const { created } = handleApi(t.ctx, { userId: BOOKER }, 'createPractices', { items: [item], groups: [G1] }) as any;
    const id = created[0];
    expect(ids('UB')).toContain(id);
    expect(ids('UC')).toContain(id);
    expect(ids('UD')).not.toContain(id);
    expect(() => handleApi(t.ctx, { userId: 'UD' }, 'getPractice', { id })).toThrow('練習が見つかりません');
    expect(() => handleApi(t.ctx, { userId: 'UD' }, 'rsvp', { id, answer: '行く' })).toThrow('練習が見つかりません');
    expect(() => handleApi(t.ctx, { userId: 'UD' }, 'addGuest', { id, name: 'ゲスト' })).toThrow('練習が見つかりません');
    expect(() => handleApi(t.ctx, { userId: 'UD' }, 'appendMemo', { id, text: 'メモ' })).toThrow('練習が見つかりません');
    expect(t.store.a.filter((a) => a.participant === 'UD')).toEqual([]);
    // 管理者は全部見える
    expect(ids(ADMIN)).toContain(id);

    handleApi(t.ctx, { userId: BOOKER }, 'recruitPractice', { id, groups: [G2] });
    expect(ids('UD')).toContain(id);
  });

  it('どこにも募集していない練習は、予約者と管理者だけに見える', () => {
    const { created } = handleApi(t.ctx, { userId: 'UB' }, 'createPractices', { items: [item], groups: [] }) as any;
    expect(ids('UB')).toContain(created[0]);
    expect(ids(ADMIN)).toContain(created[0]);
    expect(ids('UC')).not.toContain(created[0]);
  });

  it('出欠に関わった練習は、グループを抜けても見える', () => {
    const { created } = handleApi(t.ctx, { userId: BOOKER }, 'createPractices', { items: [item], groups: [G1] }) as any;
    handleApi(t.ctx, { userId: 'UB' }, 'rsvp', { id: created[0], answer: '行く' });
    handleWebhook(t.ctx, { events: [groupEvent('memberLeft', G1, { left: { members: [{ type: 'user', userId: 'UB' }] } })] });
    expect(t.store.getMember('UB')?.groups).toEqual([]);
    expect(ids('UB')).toContain(created[0]);
  });

  it('個別トークの「練習」も、その人に見える練習だけを返す', () => {
    handleApi(t.ctx, { userId: BOOKER }, 'createPractices', { items: [item], groups: [G1] });
    const text = (userId: string): LineEvent => ({ type: 'message', replyToken: 'rt', source: { type: 'user', userId }, message: { id: 'x', type: 'text', text: '練習' } });
    handleWebhook(t.ctx, { events: [text('UB')] });
    expect(t.line.lastReplyText()).toContain('10/30');
    handleWebhook(t.ctx, { events: [text('UD')] });
    expect(t.line.lastReplyText()).not.toContain('10/30');
  });

  it('グループでの発言・ボタン・参加で、入っているグループを覚える。抜けたら外す', () => {
    t.line.profiles['Unew'] = 'しん';
    handleWebhook(t.ctx, { events: [groupEvent('message', G2, { source: { type: 'group', groupId: G2, userId: 'Unew' }, message: { id: 'm', type: 'text', text: 'こんにちは' } })] });
    expect(t.store.getMember('Unew')).toMatchObject({ name: 'しん', role: '一般', groups: [G2] });
    handleWebhook(t.ctx, { events: [postback('Unew', `a=rsvp&p=x&v=1`, G1)] });
    expect(t.store.getMember('Unew')?.groups).toEqual([G2, G1]);

    handleWebhook(t.ctx, { events: [groupEvent('memberJoined', G2, { joined: { members: [{ type: 'user', userId: 'Ujoin' }] } })] });
    expect(t.store.getMember('Ujoin')?.groups).toEqual([G2]);
    handleWebhook(t.ctx, { events: [groupEvent('memberLeft', G2, { left: { members: [{ type: 'user', userId: 'Ujoin' }] } })] });
    expect(t.store.getMember('Ujoin')?.groups).toEqual([]);

    // 設定に無いグループ（Botが外れたグループなど）の発言では覚えない
    handleWebhook(t.ctx, { events: [groupEvent('message', 'Cunknown', { source: { type: 'group', groupId: 'Cunknown', userId: 'Uzz' }, message: { id: 'm', type: 'text', text: 'やあ' } })] });
    expect(t.store.getMember('Uzz')).toBeNull();
  });

  it('グループのカードから開いた人は、合言葉が合えばそのグループのメンバーとして覚える', () => {
    const { created } = handleApi(t.ctx, { userId: BOOKER }, 'createPractices', { items: [item], groups: [G1] }) as any;
    const p = t.store.getPractice(created[0])!;
    // 送り先ごとのカードに、そのグループと合言葉が入っている
    const card = JSON.stringify(t.line.pushes.find((x) => x.to === G1));
    expect(card).toContain(`g=${G1}`);
    expect(card).toContain(`k=${p.joinKey}`);

    member('UE', []);
    handleApi(t.ctx, { userId: 'UE' }, 'openedFromGroup', { id: p.id, group: G1, key: 'wrong' });
    handleApi(t.ctx, { userId: 'UE' }, 'openedFromGroup', { id: p.id, group: G2, key: p.joinKey });
    expect(t.store.getMember('UE')?.groups).toEqual([]);
    handleApi(t.ctx, { userId: 'UE' }, 'openedFromGroup', { id: p.id, group: G1, key: p.joinKey });
    expect(t.store.getMember('UE')?.groups).toEqual([G1]);
    expect(ids('UE')).toContain(p.id);
  });

  it('管理者は入っているグループを直せる。今は無いグループの記録は残す', () => {
    t.store.m.find((m) => m.userId === 'UD')!.groups = [G2, 'Cold'];
    const m = handleApi(t.ctx, { userId: ADMIN }, 'updateMember', { userId: 'UD', patch: { groups: [G1, 'Cfake'] } }) as any;
    expect(m.groups).toEqual([G1, 'Cold']);
    expect(() => handleApi(t.ctx, { userId: 'UB' }, 'updateMember', { userId: 'UD', patch: { groups: [G1] } })).toThrow('管理者だけ');
  });
});
