/**
 * スタジオと部屋の一覧（マスター）。
 * 正本は設定シート（管理画面から編集できる）で、ここの値はシートにまだ何もないときの初期値。
 * スタジオ側で部屋や広さが変わったら、管理画面で直せばコードの変更なしで反映される。
 */
import type { FeeRule, Reservation, StudioDef } from './types';

/** 2026年10月時点の各公式サイトの情報 */
export const DEFAULT_STUDIOS: StudioDef[] = [
  {
    // https://buzz-st.com/yokohama
    name: 'BUZZ横浜',
    aliases: ['BUZZ 横浜', 'バズ横浜'],
    rooms: [
      { name: '1スタジオ', size: '46.5㎡・天井2.3m' },
      { name: '2スタジオ', size: '18.0㎡・天井2.3m' },
      { name: '3スタジオ', size: '18.0㎡・天井2.3m' },
      { name: '4スタジオ', size: '14.5㎡・天井2.3m' },
      { name: '5スタジオ', size: '14.5㎡・天井2.3m' },
      { name: '6スタジオ', size: '11.0㎡・天井2.3m' },
    ],
  },
  {
    // https://buzz-st.com/yokohama3
    name: 'BUZZ横浜東口',
    aliases: ['BUZZ横浜東口(天高6ｍスタジオ)', 'BUZZ 横浜東口', '横浜東口'],
    rooms: [
      { name: 'Ast', size: '34.0㎡・鏡5.4m' },
      { name: 'Bst', size: '20.0㎡・天井6m・鏡6.3m' },
      { name: 'Cst', size: '20.0㎡・天井6m・鏡6.3m' },
      { name: 'Dst', size: '14.0㎡・天井2.3m・鏡3.6m' },
    ],
  },
  {
    // https://www.studioworcle.com/yokohama/
    name: 'studio worcle 横浜',
    aliases: ['わーくる横浜', 'ワークル横浜', 'worcle横浜', 'studio worcle yokohama', 'studio worcle 横浜店'],
    rooms: [
      { name: '101', size: '約10㎡（〜3名目安）' },
      { name: '201', size: '約20㎡（〜5名目安）' },
      { name: '202', size: '約30㎡（〜10名目安）' },
      { name: '301', size: '約20㎡（〜5名目安）' },
      { name: '302', size: '約30㎡（〜10名目安）' },
      { name: '401', size: '約50㎡（〜15名目安）' },
      { name: '501', size: '約45㎡（〜13名目安）' },
    ],
  },
];

/**
 * BUZZ の料金（30分あたり・税込）。平日は 6:00〜10:00 / 10:00〜17:00 / 17:00〜23:30、
 * 土日祝は 6:00〜10:00 / 10:00〜23:30 の料金。23:30〜翌6:00 の深夜パックは入れない（手入力）
 */
const buzz = (studio: string, room: string, [w1, w2, w3, h1, h2]: number[]): FeeRule[] => [
  { studio, room, days: '平日', from: '06:00', to: '10:00', fee: w1 },
  { studio, room, days: '平日', from: '10:00', to: '17:00', fee: w2 },
  { studio, room, days: '平日', from: '17:00', to: '23:30', fee: w3 },
  { studio, room, days: '土日祝', from: '06:00', to: '10:00', fee: h1 },
  { studio, room, days: '土日祝', from: '10:00', to: '23:30', fee: h2 },
];

/** worcle の料金（30分あたり・税込・毎日 9:00〜24:00）。24:00〜30:00 の6時間セットは入れない（手入力） */
const worcle = (room: string, fee: number): FeeRule => ({ studio: 'studio worcle 横浜', room, days: '', from: '09:00', to: '24:00', fee });

/**
 * 部屋ごとの標準料金の初期値（2026年10月時点の各公式サイトの料金表）。
 * 正本は設定シートで、シートに標準料金が1行もないときだけ使う。特定の日は料金が違うことがある
 */
export const DEFAULT_FEES: FeeRule[] = [
  // https://buzz-st.com/yokohama#price
  ...buzz('BUZZ横浜', '1スタジオ', [500, 900, 1300, 900, 1300]),
  ...buzz('BUZZ横浜', '2スタジオ', [400, 700, 900, 700, 900]),
  ...buzz('BUZZ横浜', '3スタジオ', [400, 700, 900, 700, 900]),
  ...buzz('BUZZ横浜', '4スタジオ', [400, 600, 800, 600, 800]),
  ...buzz('BUZZ横浜', '5スタジオ', [400, 600, 800, 600, 800]),
  ...buzz('BUZZ横浜', '6スタジオ', [300, 500, 600, 400, 600]),
  // https://buzz-st.com/yokohama3#price
  ...buzz('BUZZ横浜東口', 'Ast', [500, 1000, 1200, 700, 1200]),
  ...buzz('BUZZ横浜東口', 'Bst', [500, 700, 900, 600, 900]),
  ...buzz('BUZZ横浜東口', 'Cst', [500, 700, 900, 600, 900]),
  ...buzz('BUZZ横浜東口', 'Dst', [400, 600, 800, 500, 800]),
  // https://www.studioworcle.com/yokohama/
  worcle('101', 650),
  worcle('201', 800),
  worcle('202', 1100),
  worcle('301', 800),
  worcle('302', 1100),
  worcle('401', 1650),
  worcle('501', 1450),
];

/** 一覧にないスタジオを選ぶときの表示 */
export const OTHER_STUDIO = 'その他';

/** 比べるための正規化（全角半角・大文字小文字・空白をそろえる） */
const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

/** 部屋名を比べるための正規化（「Ast」「A」「Aスタジオ」、「1スタジオ」「1」をそろえる） */
const roomKey = (s: string) => norm(s).replace(/(スタジオ|studio|号室|room|st)$/u, '').replace(/^(スタジオ|studio|room)/u, '');

export function findStudio(studios: StudioDef[], name: string): StudioDef | null {
  return studios.find((s) => s.name === name) ?? null;
}

/** スタジオと部屋の組み合わせから、部屋の広さなどの補足を返す */
export function roomInfo(studios: StudioDef[], studio: string, room: string): string | null {
  const s = findStudio(studios, studio);
  const r = s?.rooms.find((x) => x.name === room);
  return r?.size || null;
}

function matchRoom(s: StudioDef, room: string): string | null {
  if (!room) return null;
  const key = roomKey(room);
  return s.rooms.find((r) => r.name === room || roomKey(r.name) === key)?.name ?? null;
}

/**
 * 読み取ったスタジオ名・部屋名を、一覧の正式な名前にそろえる。
 * 名前や別名が含まれていればそのスタジオ、候補が複数なら部屋名が合うほうを選ぶ（「横浜 301」→ studio worcle 横浜）。
 * 一覧にないものはそのまま返す。
 */
export function canonicalizeStudio(studios: StudioDef[], r: Reservation): Reservation {
  const raw = norm(r.studio);
  const names = (s: StudioDef) => [s.name, ...s.aliases].map(norm).filter(Boolean);
  let candidates = studios.filter((s) => names(s).includes(raw));
  if (candidates.length === 0) candidates = studios.filter((s) => names(s).some((n) => raw.includes(n)));
  if (candidates.length === 0 && raw) candidates = studios.filter((s) => names(s).some((n) => n.includes(raw)));
  if (candidates.length > 1) {
    // 長い名前で当たったほうを優先（「BUZZ横浜東口」に「BUZZ横浜」も当たるため）
    const score = (s: StudioDef) => Math.max(...names(s).filter((n) => raw.includes(n) || n === raw).map((n) => n.length), 0);
    const withRoom = candidates.filter((s) => matchRoom(s, r.room));
    const pool = withRoom.length > 0 ? withRoom : candidates;
    const best = Math.max(...pool.map(score));
    candidates = pool.filter((s) => score(s) === best);
  }
  if (candidates.length !== 1) return r;
  const s = candidates[0];
  return { ...r, studio: s.name, room: matchRoom(s, r.room) ?? r.room };
}
