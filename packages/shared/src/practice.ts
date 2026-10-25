import { addDays, isValidDate, jstDateTime, minutes, normalizeTime } from './dates';
import type {
  Attendance,
  CancelRule,
  DraftItem,
  Practice,
  PracticeStatus,
  Reservation,
  Settings,
} from './types';

/** 練習ID（スタジオ＋日付＋開始時刻＋部屋）。同じ予約の二重登録を防ぐためのキー */
export function makePracticeId(r: Pick<Reservation, 'studio' | 'date' | 'start' | 'room'>): string {
  const clean = (s: string) => s.replace(/[\s　/\\?#&=:]+/g, '');
  return [clean(r.studio), r.date.replace(/-/g, ''), r.start.replace(':', ''), clean(r.room)].join('-');
}

/** 読み取り結果や手入力を検証して整える。必須項目が欠けていれば null */
export function normalizeReservation(raw: Partial<Record<keyof Reservation, unknown>>): Reservation | null {
  const date = typeof raw.date === 'string' ? raw.date.trim() : '';
  const start = normalizeTime(raw.start);
  const end = normalizeTime(raw.end);
  const studio = typeof raw.studio === 'string' ? raw.studio.trim() : '';
  const room = typeof raw.room === 'string' ? raw.room.trim() : '';
  if (!isValidDate(date) || !start || !end || !studio) return null;
  if (minutes(end) <= minutes(start)) return null;
  const feeNum = typeof raw.fee === 'number' ? raw.fee : typeof raw.fee === 'string' ? Number(raw.fee.replace(/[^\d]/g, '')) : NaN;
  const fee = Number.isFinite(feeNum) && feeNum > 0 ? Math.round(feeNum) : null;
  return { date, start, end, studio, room, fee };
}

/** スタジオ・部屋の標準料金。部屋が一致するものを優先し、なければ部屋空欄の行 */
export function defaultFee(settings: Settings, studio: string, room: string): number {
  const byStudio = settings.fees.filter((f) => studio.startsWith(f.studio));
  const exact = byStudio.find((f) => f.room === room);
  if (exact) return exact.fee;
  const any = byStudio.find((f) => f.room === '');
  return any ? any.fee : 0;
}

/** 'BUZZ横浜東口' に 'BUZZ' のルールが当たるよう、前方一致で最も長いものを使う */
export function findCancelRule(rules: CancelRule[], studio: string): CancelRule | null {
  const hits = rules.filter((r) => studio.startsWith(r.studio)).sort((a, b) => b.studio.length - a.studio.length);
  return hits[0] ?? null;
}

/** キャンセル期限前警告を出す時刻 */
export function cancelWarningAt(date: string, rule: CancelRule): Date {
  return jstDateTime(addDays(date, -rule.daysBefore), rule.time);
}

export function isActive(p: Practice): boolean {
  return p.status === '募集中' || p.status === '満員';
}

/** 同じ日・同じスタジオと部屋で、既存の練習のすぐ後に続く予約なら延長とみなす */
export function findExtensionTarget(practices: Practice[], r: Reservation): Practice | null {
  return (
    practices.find(
      (p) => isActive(p) && p.date === r.date && p.studio === r.studio && p.room === r.room && p.end === r.start,
    ) ?? null
  );
}

/** 予約を「新規／延長／登録済み」に分類する */
export function classifyReservations(practices: Practice[], reservations: Reservation[]): DraftItem[] {
  const ids = new Set(practices.filter((p) => p.status !== '中止').map((p) => p.id));
  return reservations.map((reservation) => {
    const id = makePracticeId(reservation);
    if (ids.has(id)) return { reservation, kind: 'duplicate', targetId: id };
    const ext = findExtensionTarget(practices, reservation);
    if (ext) return { reservation, kind: 'extension', targetId: ext.id };
    return { reservation, kind: 'new' };
  });
}

export function goingList(attendance: Attendance[], practiceId: string): Attendance[] {
  return attendance.filter((a) => a.practiceId === practiceId && a.answer === '行く');
}

/** 割り勘。端数は単位で切り上げ。予約者が調整した金額があればそれを優先 */
export function perPersonFee(total: number, count: number, unit: number, override: number | null): number | null {
  if (override != null && override > 0) return override;
  if (count <= 0 || total <= 0) return null;
  const u = unit > 0 ? unit : 1;
  return Math.ceil(total / count / u) * u;
}

/** 人数の変化に応じて 募集中⇄満員 を切り替える。中止・終了は変えない */
export function nextStatus(p: Practice, goingCount: number): PracticeStatus {
  if (!isActive(p)) return p.status;
  return p.max != null && p.max > 0 && goingCount >= p.max ? '満員' : '募集中';
}

export function sortPractices(list: Practice[]): Practice[] {
  return [...list].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

export function yen(n: number): string {
  return `¥${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}
