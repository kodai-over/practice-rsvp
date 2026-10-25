/**
 * 業務ロジックが使う外部依存。GAS上では src/gas/ の実装を、テストではインメモリの実装を差し込む。
 */
import type { Attendance, Group, LineMessage, Member, Practice, Reservation, Settings } from '@pb/shared';

export interface Store {
  practices(): Practice[];
  getPractice(id: string): Practice | null;
  savePractice(p: Practice, bookerName?: string): void;
  attendance(practiceId?: string): Attendance[];
  saveAttendance(a: Attendance): void;
  deleteAttendance(practiceId: string, participant: string): void;
  members(): Member[];
  getMember(userId: string): Member | null;
  saveMember(m: Member): void;
  settings(): Settings;
  saveSettings(s: Settings): void;
}

export interface LineApi {
  /** 失敗（期限切れの応答トークンなど）は例外を投げる */
  reply(replyToken: string, messages: LineMessage[]): void;
  push(to: string, messages: LineMessage[]): void;
  profile(userId: string): { displayName: string } | null;
  groupMemberProfile(groupId: string, userId: string): { displayName: string } | null;
  groupSummary(groupId: string): { groupName: string } | null;
  content(messageId: string): Image;
}

export interface Image {
  mimeType: string;
  /** base64 */
  data: string;
}

export interface ScreenshotReader {
  /** 読み取った予約。読めない項目は null / 欠落のまま返す */
  read(images: Image[], today: string): Partial<Record<keyof Reservation, unknown>>[];
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
