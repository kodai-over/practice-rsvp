export type PracticeStatus = '募集中' | '満員' | '中止' | '終了';
export type Role = '管理者' | '予約者' | '一般';
export type AttendeeKind = 'メンバー' | 'ゲスト';
export type Via = 'ボタン' | 'アプリ' | '参加リンク';
export type Answer = '行く' | '保留' | '行かない';
export const ANSWERS: Answer[] = ['行く', '保留', '行かない'];
export const isAnswer = (v: unknown): v is Answer => ANSWERS.includes(v as Answer);

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

/** 標準料金の曜日の区分。'' は毎日 */
export type FeeDays = '' | '平日' | '土日祝';

/**
 * スタジオの標準料金（30分あたり）。部屋が '' なら全部屋。
 * days・from・to で曜日と時間帯を絞れる（from/to が '' なら終日。to は '24:00' のように書く）
 */
export interface FeeRule {
  studio: string;
  room: string;
  fee: number;
  days?: FeeDays;
  from?: string;
  to?: string;
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

/** 部屋。size は広さなどの補足（例: 46.5㎡・天井2.3m） */
export interface RoomDef {
  name: string;
  size: string;
}

/** スタジオ。aliases は読み取りや手入力の表記ゆれを正式な名前にそろえるための別名 */
export interface StudioDef {
  name: string;
  aliases: string[];
  rooms: RoomDef[];
}

export interface Settings {
  studios: StudioDef[];
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
  /** 今日より前、または今日すでに終わった時間帯で、登録しなかった予約の件数 */
  pastCount: number;
  /** すでに登録済みで、登録しなかった予約の件数（古い下書きには無い） */
  duplicateCount?: number;
  groups: string[];
  createdAt: string;
}

export type FeedbackStatus = '未対応' | '検討中' | '改善済み' | '見送り';
export const FEEDBACK_STATUSES: FeedbackStatus[] = ['未対応', '検討中', '改善済み', '見送り'];

/** 改善要望。投稿者の名前はみんなに公開する */
export interface Feedback {
  id: string;
  userId: string;
  name: string;
  text: string;
  status: FeedbackStatus;
  reply: string;
  createdAt: string;
}
