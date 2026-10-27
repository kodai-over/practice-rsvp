/**
 * スプレッドシートの4シートの列と、行⇄データの変換。
 * 列は見出し名で引くので、管理者が列を並べ替えても動く。
 */
import { DEFAULT_FEES, DEFAULT_STUDIOS, formatFeeValue, parseFeeValue, type Attendance, type Feedback, type Member, type Practice, type Settings, type StudioDef } from '@studio-attendance/shared';

export type Row = Record<string, string>;

/**
 * シートに書く値。メンバーが自由に付けた値（グループ名・表示名・要望など）も入るので、空でなければ先頭に ' を付けて書く。
 * Sheets は書いた値の先頭の ' を必ず1つ外して文字列として保存するため（書式なしテキストの列でも同じ）、
 * = で始まる値が数式になったり、0123 や -5 が数値に変わったりしない。読むときは何もしなくてよい
 */
export const toCell = (v: string): string => (v ? `'${v}` : v);

export const SHEETS = {
  practices: {
    name: '練習',
    headers: [
      '練習ID', '日付', '開始', '終了', 'スタジオ', '部屋', '料金', '予約者', '予約者名', '上限人数', '最低人数',
      'メモ', '状態', '送り先グループ', '参加キー', '1人料金(調整)', '警告送信済', '登録日時',
    ],
  },
  attendance: {
    name: '出欠',
    headers: ['練習ID', '参加者', '表示名', '種別', '登録経路', '追加した人', '回答', '更新日時'],
  },
  members: {
    name: 'メンバー',
    headers: ['LINEユーザーID', '表示名', '権限', 'ふだんの送り先グループ', '所属グループ'],
  },
  settings: {
    name: '設定',
    headers: ['種別', 'キー1', 'キー2', '値'],
  },
  feedback: {
    name: '要望',
    headers: ['要望ID', '投稿者', '投稿者名', '内容', '状態', '管理者コメント', '投稿日時'],
  },
} as const;

const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const numOrNull = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s));

export function rowToPractice(r: Row): Practice {
  return {
    id: r['練習ID'],
    date: r['日付'],
    start: r['開始'],
    end: r['終了'],
    studio: r['スタジオ'],
    room: r['部屋'] ?? '',
    fee: Number(r['料金']) || 0,
    booker: r['予約者'],
    max: numOrNull(r['上限人数'] ?? ''),
    min: numOrNull(r['最低人数'] ?? ''),
    memo: r['メモ'] ?? '',
    status: (r['状態'] || '募集中') as Practice['status'],
    groups: list(r['送り先グループ'] ?? ''),
    joinKey: r['参加キー'] ?? '',
    feeOverride: numOrNull(r['1人料金(調整)'] ?? ''),
    warned: (r['警告送信済'] ?? '') !== '',
    createdAt: r['登録日時'] ?? '',
  };
}

export function practiceToRow(p: Practice, bookerName?: string): Row {
  const row: Row = {
    練習ID: p.id,
    日付: p.date,
    開始: p.start,
    終了: p.end,
    スタジオ: p.studio,
    部屋: p.room,
    料金: String(p.fee),
    予約者: p.booker,
    上限人数: p.max == null ? '' : String(p.max),
    最低人数: p.min == null ? '' : String(p.min),
    メモ: p.memo,
    状態: p.status,
    送り先グループ: p.groups.join(','),
    参加キー: p.joinKey,
    '1人料金(調整)': p.feeOverride == null ? '' : String(p.feeOverride),
    警告送信済: p.warned ? '済' : '',
    登録日時: p.createdAt,
  };
  if (bookerName !== undefined) row['予約者名'] = bookerName;
  return row;
}

export function rowToAttendance(r: Row): Attendance {
  return {
    practiceId: r['練習ID'],
    participant: r['参加者'],
    name: r['表示名'] ?? '',
    kind: (r['種別'] || 'メンバー') as Attendance['kind'],
    via: (r['登録経路'] || 'ボタン') as Attendance['via'],
    addedBy: r['追加した人'] ?? '',
    answer: (r['回答'] || '行く') as Attendance['answer'],
    updatedAt: r['更新日時'] ?? '',
  };
}

export function attendanceToRow(a: Attendance): Row {
  return {
    練習ID: a.practiceId,
    参加者: a.participant,
    表示名: a.name,
    種別: a.kind,
    登録経路: a.via,
    追加した人: a.addedBy,
    回答: a.answer,
    更新日時: a.updatedAt,
  };
}

export function rowToMember(r: Row): Member {
  return {
    userId: r['LINEユーザーID'],
    name: r['表示名'] ?? '',
    role: (r['権限'] || '一般') as Member['role'],
    defaultGroups: list(r['ふだんの送り先グループ'] ?? ''),
    groups: list(r['所属グループ'] ?? ''),
  };
}

export function memberToRow(m: Member): Row {
  return {
    LINEユーザーID: m.userId,
    表示名: m.name,
    権限: m.role,
    ふだんの送り先グループ: m.defaultGroups.join(','),
    所属グループ: m.groups.join(','),
  };
}

export function rowToFeedback(r: Row): Feedback {
  return {
    id: r['要望ID'],
    userId: r['投稿者'] ?? '',
    name: r['投稿者名'] ?? '',
    text: r['内容'] ?? '',
    // 以前の「対応済み」は「改善済み」として扱う
    status: (r['状態'] === '対応済み' ? '改善済み' : r['状態'] || '未対応') as Feedback['status'],
    reply: r['管理者コメント'] ?? '',
    createdAt: r['投稿日時'] ?? '',
  };
}

export function feedbackToRow(f: Feedback): Row {
  return {
    要望ID: f.id,
    投稿者: f.userId,
    投稿者名: f.name,
    内容: f.text,
    状態: f.status,
    管理者コメント: f.reply,
    投稿日時: f.createdAt,
  };
}

/**
 * 設定シートは1行1項目。
 *   標準料金     | スタジオ | 部屋（空欄=全部屋） | 30分あたりの金額。曜日・時間帯を付けられる（例「平日 17:00-23:30 1300」）
 *   キャンセル期限 | スタジオ | 何日前             | 警告時刻
 *   グループ     | グループID |                   | 表示名
 *   共通        | 最低人数標準 / 切り上げ単位 |      | 値
 */
export function rowsToSettings(rows: Row[]): Settings {
  const s: Settings = { studios: [], fees: [], cancelRules: [], minDefault: 3, roundUnit: 10, groups: [] };
  const studio = (name: string): StudioDef => {
    let found = s.studios.find((x) => x.name === name);
    if (!found) s.studios.push((found = { name, aliases: [], rooms: [] }));
    return found;
  };
  for (const r of rows) {
    const [kind, k1, k2, v] = [r['種別'], r['キー1'] ?? '', r['キー2'] ?? '', r['値'] ?? ''].map((x) => (x ?? '').trim());
    if (kind === 'スタジオ' && k1) studio(k1).aliases = k2.split(/[,、]/).map((x) => x.trim()).filter(Boolean);
    else if (kind === '部屋' && k1 && k2) studio(k1).rooms.push({ name: k2, size: v });
    else if (kind === '標準料金' && k1) {
      const f = parseFeeValue(v);
      if (f) s.fees.push({ studio: k1, room: k2, ...f });
    }
    else if (kind === 'キャンセル期限' && k1) s.cancelRules.push({ studio: k1, daysBefore: Number(k2) || 0, time: v || '10:00' });
    else if (kind === 'グループ' && k1) s.groups.push({ id: k1, name: v || k1 });
    else if (kind === '共通' && k1 === '最低人数標準') s.minDefault = Number(v) || s.minDefault;
    else if (kind === '共通' && k1 === '切り上げ単位') s.roundUnit = Number(v) || s.roundUnit;
  }
  // シートにスタジオがまだ1件もなければ、コードの初期値（公式サイトの情報）を使う
  if (s.studios.length === 0) s.studios = DEFAULT_STUDIOS.map((x) => ({ ...x, aliases: [...x.aliases], rooms: x.rooms.map((r) => ({ ...r })) }));
  // 標準料金も同じ。0円の行しかなければ、まだ入力されていないとみなす
  if (!s.fees.some((f) => f.fee > 0)) s.fees = DEFAULT_FEES.map((f) => ({ ...f }));
  return s;
}

/**
 * 設定シートは1行1項目。
 *   スタジオ     | スタジオ名 | 別名（カンマ区切り） |
 *   部屋        | スタジオ名 | 部屋名              | 広さなどの補足
 */
export function settingsToRows(s: Settings): Row[] {
  return [
    { 種別: '共通', キー1: '最低人数標準', キー2: '', 値: String(s.minDefault) },
    { 種別: '共通', キー1: '切り上げ単位', キー2: '', 値: String(s.roundUnit) },
    ...s.studios.flatMap((st) => [
      { 種別: 'スタジオ', キー1: st.name, キー2: st.aliases.join(','), 値: '' },
      ...st.rooms.map((r) => ({ 種別: '部屋', キー1: st.name, キー2: r.name, 値: r.size })),
    ]),
    ...s.fees.map((f) => ({ 種別: '標準料金', キー1: f.studio, キー2: f.room, 値: formatFeeValue(f) })),
    ...s.cancelRules.map((c) => ({ 種別: 'キャンセル期限', キー1: c.studio, キー2: String(c.daysBefore), 値: c.time })),
    ...s.groups.map((g) => ({ 種別: 'グループ', キー1: g.id, キー2: '', 値: g.name })),
  ];
}

/** 初期の設定。料金は公式サイトの料金表（変わったら管理画面で直す） */
export const INITIAL_SETTINGS: Settings = {
  studios: DEFAULT_STUDIOS,
  minDefault: 3,
  roundUnit: 10,
  fees: DEFAULT_FEES,
  cancelRules: [
    // worcle は利用日の3日前から100%のため、その前日（4日前）の10時に警告
    { studio: 'worcle', daysBefore: 4, time: '10:00' },
    // BUZZ は利用規約を確認して直す（仮: 前日10時）
    { studio: 'BUZZ', daysBefore: 1, time: '10:00' },
  ],
  groups: [],
};
