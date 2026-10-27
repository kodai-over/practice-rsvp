import type { Attendance, Feedback, Member, Practice, Settings } from '@studio-attendance/shared';
import type { Store } from '../app/ports';
import {
  SHEETS,
  attendanceToRow,
  feedbackToRow,
  memberToRow,
  practiceToRow,
  rowToAttendance,
  rowToFeedback,
  rowToMember,
  rowToPractice,
  rowsToSettings,
  settingsToRows,
  fromCell,
  toCell,
  type Row,
} from '../app/schema';

const TZ = 'Asia/Tokyo';

function cellToString(header: string, v: unknown): string {
  if (v instanceof Date) {
    if (header === '日付') return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
    if (header === '開始' || header === '終了') return Utilities.formatDate(v, TZ, 'HH:mm');
    return v.toISOString();
  }
  return v == null ? '' : fromCell(String(v));
}

/** 1枚のシートを「見出し名→値」の行として読み書きする */
class Table {
  private cache: { headers: string[]; rows: Row[] } | null = null;

  constructor(
    private readonly ss: GoogleAppsScript.Spreadsheet.Spreadsheet,
    private readonly name: string,
    private readonly headers: readonly string[],
  ) {}

  /** シートがなければ見出し付きで作る（後から追加したシートも setupSheets なしで使えるように） */
  private sheet() {
    const sh = this.ss.getSheetByName(this.name);
    if (sh) return sh;
    const created = this.ss.insertSheet(this.name);
    created.getRange(1, 1, created.getMaxRows(), this.headers.length).setNumberFormat('@');
    created.getRange(1, 1, 1, this.headers.length).setValues([[...this.headers]]).setFontWeight('bold');
    created.setFrozenRows(1);
    return created;
  }

  invalidate() {
    this.cache = null;
  }

  private load() {
    if (this.cache) return this.cache;
    const values = this.sheet().getDataRange().getValues();
    const headers = (values[0] ?? []).map((h) => String(h).trim());
    const rows = values.slice(1).map((line) => {
      const r: Row = {};
      headers.forEach((h, i) => (r[h] = cellToString(h, line[i])));
      return r;
    });
    this.cache = { headers, rows };
    return this.cache;
  }

  rows(): Row[] {
    return this.load().rows;
  }

  /**
   * match に一致する行を更新、なければ末尾に追加。row に無い列は今の値を残す。
   * 書いた内容は手元の控えにも反映し、シート全体を読み直さない（登録を速くするため）
   */
  upsert(match: (r: Row) => boolean, row: Row) {
    const cache = this.load();
    const idx = cache.rows.findIndex(match);
    const merged: Row = { ...(idx >= 0 ? cache.rows[idx] : {}), ...row };
    const line = cache.headers.map((h) => toCell(merged[h] ?? ''));
    const sh = this.sheet();
    if (idx >= 0) {
      sh.getRange(idx + 2, 1, 1, cache.headers.length).setValues([line]);
      cache.rows[idx] = merged;
    } else {
      sh.appendRow(line);
      cache.rows.push(merged);
    }
  }

  delete(match: (r: Row) => boolean) {
    const cache = this.load();
    const sh = this.sheet();
    for (let i = cache.rows.length - 1; i >= 0; i--) {
      if (match(cache.rows[i])) {
        sh.deleteRow(i + 2);
        cache.rows.splice(i, 1);
      }
    }
  }

  replaceAll(rows: Row[]) {
    const cache = this.load();
    const sh = this.sheet();
    const last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, cache.headers.length).clearContent();
    if (rows.length) sh.getRange(2, 1, rows.length, cache.headers.length).setValues(rows.map((r) => cache.headers.map((h) => toCell(r[h] ?? ''))));
    // 消したあとの空行は読み直しで出ないので、控えも書いた行だけにする
    cache.rows = rows.map((r) => Object.fromEntries(cache.headers.map((h) => [h, r[h] ?? ''])));
  }
}

export class SheetStore implements Store {
  private readonly t: Record<keyof typeof SHEETS, Table>;

  constructor(ss: GoogleAppsScript.Spreadsheet.Spreadsheet) {
    this.t = {
      practices: new Table(ss, SHEETS.practices.name, SHEETS.practices.headers),
      attendance: new Table(ss, SHEETS.attendance.name, SHEETS.attendance.headers),
      members: new Table(ss, SHEETS.members.name, SHEETS.members.headers),
      settings: new Table(ss, SHEETS.settings.name, SHEETS.settings.headers),
      feedback: new Table(ss, SHEETS.feedback.name, SHEETS.feedback.headers),
    };
  }

  /** ロックを取った直後に呼び、他の実行による書き込みを読み直す */
  invalidate() {
    Object.values(this.t).forEach((t) => t.invalidate());
  }

  practices(): Practice[] {
    return this.t.practices.rows().filter((r) => r['練習ID']).map(rowToPractice);
  }

  getPractice(id: string): Practice | null {
    const r = this.t.practices.rows().find((x) => x['練習ID'] === id);
    return r ? rowToPractice(r) : null;
  }

  savePractice(p: Practice, bookerName?: string) {
    this.t.practices.upsert((r) => r['練習ID'] === p.id, practiceToRow(p, bookerName));
  }

  deletePractice(id: string) {
    this.t.attendance.delete((r) => r['練習ID'] === id);
    this.t.practices.delete((r) => r['練習ID'] === id);
  }

  attendance(practiceId?: string): Attendance[] {
    return this.t.attendance
      .rows()
      .filter((r) => r['練習ID'] && (!practiceId || r['練習ID'] === practiceId))
      .map(rowToAttendance);
  }

  saveAttendance(a: Attendance) {
    this.t.attendance.upsert((r) => r['練習ID'] === a.practiceId && r['参加者'] === a.participant, attendanceToRow(a));
  }

  deleteAttendance(practiceId: string, participant: string) {
    this.t.attendance.delete((r) => r['練習ID'] === practiceId && r['参加者'] === participant);
  }

  members(): Member[] {
    return this.t.members.rows().filter((r) => r['LINEユーザーID']).map(rowToMember);
  }

  getMember(userId: string): Member | null {
    const r = this.t.members.rows().find((x) => x['LINEユーザーID'] === userId);
    return r ? rowToMember(r) : null;
  }

  saveMember(m: Member) {
    this.t.members.upsert((r) => r['LINEユーザーID'] === m.userId, memberToRow(m));
  }

  settings(): Settings {
    return rowsToSettings(this.t.settings.rows());
  }

  saveSettings(s: Settings) {
    this.t.settings.replaceAll(settingsToRows(s));
  }

  feedback(): Feedback[] {
    return this.t.feedback.rows().filter((r) => r['要望ID']).map(rowToFeedback);
  }

  saveFeedback(f: Feedback) {
    this.t.feedback.upsert((r) => r['要望ID'] === f.id, feedbackToRow(f));
  }

  deleteFeedback(id: string) {
    this.t.feedback.delete((r) => r['要望ID'] === id);
  }
}
