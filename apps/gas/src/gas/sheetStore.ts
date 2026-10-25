import type { Attendance, Member, Practice, Settings } from '@pb/shared';
import type { Store } from '../app/ports';
import {
  SHEETS,
  attendanceToRow,
  memberToRow,
  practiceToRow,
  rowToAttendance,
  rowToMember,
  rowToPractice,
  rowsToSettings,
  settingsToRows,
  type Row,
} from '../app/schema';

const TZ = 'Asia/Tokyo';

function cellToString(header: string, v: unknown): string {
  if (v instanceof Date) {
    if (header === '日付') return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
    if (header === '開始' || header === '終了') return Utilities.formatDate(v, TZ, 'HH:mm');
    return v.toISOString();
  }
  return v == null ? '' : String(v);
}

/** 1枚のシートを「見出し名→値」の行として読み書きする */
class Table {
  private cache: { headers: string[]; rows: Row[] } | null = null;

  constructor(
    private readonly ss: GoogleAppsScript.Spreadsheet.Spreadsheet,
    private readonly name: string,
  ) {}

  private sheet() {
    const sh = this.ss.getSheetByName(this.name);
    if (!sh) throw new Error(`シート「${this.name}」がありません。setupSheets を実行してください。`);
    return sh;
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

  /** match に一致する行を更新、なければ末尾に追加。row に無い列は今の値を残す */
  upsert(match: (r: Row) => boolean, row: Row) {
    const { headers, rows } = this.load();
    const idx = rows.findIndex(match);
    const base = idx >= 0 ? rows[idx] : {};
    const merged = { ...base, ...row };
    const line = headers.map((h) => merged[h] ?? '');
    const sh = this.sheet();
    if (idx >= 0) sh.getRange(idx + 2, 1, 1, headers.length).setValues([line]);
    else sh.appendRow(line);
    this.invalidate();
  }

  delete(match: (r: Row) => boolean) {
    const rows = this.load().rows;
    const sh = this.sheet();
    for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i])) sh.deleteRow(i + 2);
    this.invalidate();
  }

  replaceAll(rows: Row[]) {
    const { headers } = this.load();
    const sh = this.sheet();
    const last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, headers.length).clearContent();
    if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows.map((r) => headers.map((h) => r[h] ?? '')));
    this.invalidate();
  }
}

export class SheetStore implements Store {
  private readonly t: Record<keyof typeof SHEETS, Table>;

  constructor(ss: GoogleAppsScript.Spreadsheet.Spreadsheet) {
    this.t = {
      practices: new Table(ss, SHEETS.practices.name),
      attendance: new Table(ss, SHEETS.attendance.name),
      members: new Table(ss, SHEETS.members.name),
      settings: new Table(ss, SHEETS.settings.name),
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
}
