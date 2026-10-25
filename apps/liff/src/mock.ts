/**
 * `npm run dev:mock` 用。Apps Script と同じ業務ロジックをブラウザ内のメモリで動かし、
 * LINEやGoogleの準備がなくても画面を確かめられるようにする。
 */
import { addDays, DEFAULT_FEES, DEFAULT_STUDIOS, makePracticeId, toJstDate, type LineMessage, type Practice } from '@pb/shared';
import { MemoryKv, MemoryStore } from '../../gas/src/app/memory';
import type { Ctx } from '../../gas/src/app/ports';
import { route } from '../../gas/src/app/router';

const today = toJstDate(new Date());
const store = new MemoryStore();
store.m = [
  { userId: 'Ume', name: 'おおゆち', role: '管理者', defaultGroups: ['G1'] },
  { userId: 'U2', name: 'さくら', role: '予約者', defaultGroups: ['G2'] },
  { userId: 'U3', name: 'けんた', role: '一般', defaultGroups: [] },
  { userId: 'U4', name: 'みお', role: '一般', defaultGroups: [] },
];
store.s = {
  studios: DEFAULT_STUDIOS,
  fees: DEFAULT_FEES,
  cancelRules: [
    { studio: 'worcle', daysBefore: 4, time: '10:00' },
    { studio: 'BUZZ', daysBefore: 1, time: '10:00' },
  ],
  minDefault: 3,
  roundUnit: 10,
  groups: [
    { id: 'G1', name: 'ショーケース組' },
    { id: 'G2', name: 'サークル全体' },
  ],
};

const mk = (days: number, start: string, end: string, studio: string, room: string, fee: number, booker: string, over: Partial<Practice> = {}): Practice => {
  const date = addDays(today, days);
  return {
    id: makePracticeId({ studio, date, start, room }),
    date,
    start,
    end,
    studio,
    room,
    fee,
    booker,
    max: null,
    min: null,
    memo: '',
    status: '募集中',
    groups: ['G1'],
    joinKey: 'mockkey',
    feeOverride: null,
    warned: false,
    createdAt: new Date().toISOString(),
    ...over,
  };
};
store.p = [
  mk(2, '19:00', '21:00', 'studio worcle 横浜', '202', 4400, 'Ume', { memo: 'ショーケースの通し' }),
  mk(5, '13:00', '16:00', 'BUZZ横浜東口', 'Bst', 5400, 'U2', { max: 3, groups: ['G1', 'G2'] }),
  mk(9, '20:00', '22:00', '市民センター', '和室', 1200, 'Ume'),
];
const att = (practiceId: string, participant: string, name: string, answer: '行く' | '保留' | '行かない', kind: 'メンバー' | 'ゲスト' = 'メンバー', addedBy = participant) =>
  store.saveAttendance({ practiceId, participant, name, kind, via: kind === 'ゲスト' ? 'アプリ' : 'ボタン', addedBy, answer, updatedAt: new Date().toISOString() });
att(store.p[0].id, 'Ume', 'おおゆち', '行く');
att(store.p[0].id, 'U3', 'けんた', '行く');
att(store.p[0].id, 'guest:1', 'りな', '行く', 'ゲスト', 'U3');
att(store.p[0].id, 'U4', 'みお', '行かない');
att(store.p[1].id, 'U2', 'さくら', '行く');
att(store.p[1].id, 'U3', 'けんた', '行く');
att(store.p[0].id, 'U2', 'さくら', '保留');

store.f = [
  { id: 'f1', userId: 'U3', name: 'けんた', text: '練習の前日にリマインドがほしい', status: '改善済み', reply: '前日にアプリの「自分が行く」で確認できるようにしました', createdAt: new Date(Date.now() - 86400000).toISOString() },
  { id: 'f2', userId: 'U4', name: 'みお', text: 'スタジオの地図リンクを載せてほしい', status: '未対応', reply: '', createdAt: new Date().toISOString() },
];

let seq = 0;
const ctx: Ctx = {
  store,
  kv: new MemoryKv(),
  line: {
    reply() {},
    push(to: string, messages: LineMessage[]) {
      console.info('[mock push]', to, messages);
    },
    profile: () => null,
    groupMemberProfile: () => null,
    groupSummary: () => null,
    content: () => ({ mimeType: 'image/jpeg', data: '' }),
    showLoading: () => {},
  },
  reader: {
    // 予約一覧のスクショ（過去の予約・続けて取った予約・延長・読めない行を含む）を読んだ想定
    read: () => [
      { date: addDays(today, -3), start: '19:00', end: '20:30', studio: '横浜', room: '301', fee: 2400 },
      { date: addDays(today, 12), start: '19:00', end: '20:30', studio: '横浜', room: '301', fee: 2400 },
      { date: addDays(today, 12), start: '20:30', end: '21:00', studio: '横浜', room: '301', fee: 800 },
      { date: addDays(today, 2), start: '21:00', end: '22:00', studio: 'わーくる横浜', room: '202', fee: 2200 },
      { date: addDays(today, 14), start: null, end: null, studio: 'BUZZ横浜', room: '1', fee: null },
    ],
  },
  withLock: (fn) => fn(),
  config: { appUrl: location.origin + location.pathname, joinPageUrl: new URL('join.html', location.href).href, gasUrl: '#' },
  now: () => new Date(),
  uuid: () => `mock${++seq}`,
  log: (...a) => console.log(...a),
};

export async function mockRoute(body: Record<string, unknown>) {
  // 読み取りは本番でも時間がかかるので、モックでも待たせて表示を確かめられるようにする
  await new Promise((r) => setTimeout(r, body.action === 'parseReservations' ? 2000 : 150));
  const user = new URLSearchParams(location.search).get('as') ?? 'Ume';
  return route(ctx, JSON.stringify({ ...body, idToken: 'mock' }), { relay: () => false, idToken: () => ({ userId: user, name: 'ゲストユーザー' }) });
}
