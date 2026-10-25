export type PracticeStatus = '募集中' | '満員' | '中止' | '終了';
export type Role = '管理者' | '予約者' | '一般';
export type AttendeeKind = 'メンバー' | 'ゲスト';
export type Via = 'ボタン' | 'アプリ' | '参加リンク';
export type Answer = '行く' | '行かない';

/** 日付は 'YYYY-MM-DD'、時刻は 'HH:mm'（いずれも日本時間） */
export interface Practice {
  id: string;
  date: string;
  start: string;
  end: string;
  studio: string;
  room: string;
  fee: number;
  booker: string;
  max: number | null;
  min: number | null;
  memo: string;
  status: PracticeStatus;
  groups: string[];
  joinKey: string;
  feeOverride: number | null;
  warned: boolean;
  createdAt: string;
}

export interface Attendance {
  practiceId: string;
  /** メンバーはLINEユーザーID、ゲストは 'guest:' で始まるID */
  participant: string;
  name: string;
  kind: AttendeeKind;
  via: Via;
  addedBy: string;
  answer: Answer;
  updatedAt: string;
}

export interface Member {
  userId: string;
  name: string;
  role: Role;
  defaultGroups: string[];
}

export interface FeeRule {
  studio: string;
  room: string;
  fee: number;
}

export interface CancelRule {
  studio: string;
  daysBefore: number;
  time: string;
}

export interface Group {
  id: string;
  name: string;
}

export interface Settings {
  fees: FeeRule[];
  cancelRules: CancelRule[];
  minDefault: number;
  roundUnit: number;
  groups: Group[];
}

/** スクショや手入力から得た、登録前の予約1件 */
export interface Reservation {
  date: string;
  start: string;
  end: string;
  studio: string;
  room: string;
  fee: number | null;
}

export type DraftItemKind = 'new' | 'extension' | 'duplicate';

export interface DraftItem {
  reservation: Reservation;
  kind: DraftItemKind;
  /** extension / duplicate のときの対象練習ID */
  targetId?: string;
}

export interface Draft {
  id: string;
  booker: string;
  items: DraftItem[];
  /** 必須項目が読み取れなかった予約（アプリで入力してもらう） */
  incomplete: Partial<Reservation>[];
  groups: string[];
  createdAt: string;
}
