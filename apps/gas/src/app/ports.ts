/**
 * 業務ロジックが使う外部依存。GAS上では src/gas/ の実装を、テストではインメモリの実装を差し込む。
 */
import type { Attendance, Feedback, Group, LineMessage, Member, Practice, Reservation, Settings, StudioDef } from '@pb/shared';

export interface Store {
  practices(): Practice[];
  getPractice(id: string): Practice | null;
  savePractice(p: Practice, bookerName?: string): void;
  /** 練習と、その出欠をまとめて消す */
  deletePractice(id: string): void;
  attendance(practiceId?: string): Attendance[];
  saveAttendance(a: Attendance): void;
  deleteAttendance(practiceId: string, participant: string): void;
  members(): Member[];
  getMember(userId: string): Member | null;
  saveMember(m: Member): void;
  settings(): Settings;
  saveSettings(s: Settings): void;
  feedback(): Feedback[];
  saveFeedback(f: Feedback): void;
  deleteFeedback(id: string): void;
}

export interface LineApi {
  /** 失敗（期限切れの応答トークンなど）は例外を投げる */
  reply(replyToken: string, messages: LineMessage[]): void;
  push(to: string, messages: LineMessage[]): void;
  profile(userId: string): { displayName: string } | null;
  groupMemberProfile(groupId: string, userId: string): { displayName: string } | null;
  groupSummary(groupId: string): { groupName: string } | null;
  content(messageId: string): Image;
  /** 個別トークに「入力中…」の表示を出す（読み取りに時間がかかるとき） */
  showLoading(userId: string, seconds: number): void;
}

export interface Image {
  mimeType: string;
  /** base64 */
  data: string;
}

export type RawReservation = Partial<Record<keyof Reservation, unknown>>;

/** 読み取る材料。スクショ（複数可）か、予約内容の文章 */
export interface ReaderInput {
  images: Image[];
  text?: string;
}

export interface ReaderHints {
  /** 今日の日付（年の補完に使う） */
  today: string;
  /** スタジオ・部屋の一覧（設定シートのもの＋これまでに登録された一覧外のスタジオ）。読み取り結果を正式な名前にそろえるのに使う */
  studios: StudioDef[];
}

export interface ScreenshotReader {
  /** 読み取った予約。読めない項目は null / 欠落のまま返す */
  read(input: ReaderInput, hints: ReaderHints): RawReservation[];
}

export interface Kv {
  get(key: string): string | null;
  put(key: string, value: string, ttlSeconds: number): void;
  remove(key: string): void;
}

export interface Config {
  /** LIFFアプリのURL（https://liff.line.me/{LIFF_ID}） */
  appUrl: string;
  /** 参加リンクのページ（GitHub Pages の join.html） */
  joinPageUrl: string;
  /** Apps Script のウェブアプリURL（.ics の配信に使う） */
  gasUrl: string;
}

export interface Ctx {
  store: Store;
  line: LineApi;
  reader: ScreenshotReader;
  kv: Kv;
  withLock<T>(fn: () => T): T;
  config: Config;
  now(): Date;
  uuid(): string;
  log(...args: unknown[]): void;
}

/** 利用者にそのまま見せてよいエラー */
export class UserError extends Error {}

export type GroupList = Group[];
