import { addDays, isHolidayOrWeekend, isValidDate, jstDateTime, minutes, normalizeTime } from './dates';
import type {
  Attendance,
  CancelRule,
  DraftItem,
  FeeDays,
  FeeRule,
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

/** 設定のスタジオ名がスタジオ名に含まれるか（「BUZZ」→「BUZZ横浜東口」、「worcle」→「studio worcle 横浜」） */
const studioMatches = (key: string, studio: string) => key !== '' && studio.toLowerCase().includes(key.toLowerCase());

/** そのスタジオ・部屋に当たる標準料金の設定 */
export function feeRulesFor(settings: Settings, studio: string, room: string): FeeRule[] {
  return settings.fees.filter((f) => f.fee > 0 && studioMatches(f.studio, studio) && (f.room === '' || f.room === room));
}

/** 時刻（分）が料金の時間帯に入るか。'24:00' をまたぐ時間帯（例 '23:30'〜'30:00'）は翌日の分も見る */
function inBand(f: FeeRule, m: number): boolean {
  if (!f.from || !f.to) return true;
  const from = minutes(f.from);
  const to = minutes(f.to);
  return (m >= from && m < to) || (m + 1440 >= from && m + 1440 < to);
}

/** 細かく書かれた設定ほど優先する（スタジオ名が長い・部屋の指定あり・曜日の指定あり・時間帯の指定あり） */
const ruleScore = (f: FeeRule) => f.studio.length * 8 + (f.room ? 4 : 0) + (f.days ? 2 : 0) + (f.from && f.to ? 1 : 0);

/**
 * 標準料金で計算したスタジオ代。30分ごとに、その日（平日・土日祝）と時間帯の料金を足す。
 * 料金の設定がない時間帯が1つでもあれば計算できないので 0 を返す（手で入力してもらう）
 */
export function defaultFee(settings: Settings, r: Pick<Reservation, 'studio' | 'room' | 'date' | 'start' | 'end'>): number {
  if (!r.studio || !r.start || !r.end) return 0;
  const rules = feeRulesFor(settings, r.studio, r.room);
  const start = minutes(r.start);
  const end = minutes(r.end);
  if (rules.length === 0 || end <= start) return 0;
  let total = 0;
  for (let m = start; m < end; m += 30) {
    // 24:00 を過ぎた分は翌日として曜日を見る
    const date = r.date ? (m >= 1440 ? addDays(r.date, 1) : r.date) : '';
    const holiday = date ? isHolidayOrWeekend(date) : false;
    const hit = rules
      .filter((f) => (!f.days || (date && (f.days === '土日祝') === holiday)) && inBand(f, m % 1440))
      .sort((a, b) => ruleScore(b) - ruleScore(a))[0];
    if (!hit) return 0;
    total += (hit.fee * (Math.min(end, m + 30) - m)) / 30;
  }
  return Math.round(total);
}

/** 設定シートの値の書き方: 「1300」「平日 17:00-23:30 1300」「土日祝 10:00-23:30 1300」 */
export function parseFeeValue(v: string): Pick<FeeRule, 'fee' | 'days' | 'from' | 'to'> | null {
  const m = v
    .normalize('NFKC')
    .trim()
    .match(/^(?:(平日|土日祝)\s*)?(?:(\d{1,2}:\d{2})\s*[-〜~]\s*(\d{1,2}:\d{2})\s*)?([\d,]+)\s*円?$/);
  if (!m) return null;
  const from = m[2] ? normalizeTime(m[2]) : null;
  const to = m[3] ? normalizeTime(m[3]) : null;
  return { days: (m[1] as FeeDays | undefined) ?? '', from: from ?? '', to: to ?? '', fee: Number(m[4].replace(/,/g, '')) };
}

export function formatFeeValue(f: FeeRule): string {
  return [f.days, f.from && f.to ? `${f.from}-${f.to}` : '', String(f.fee)].filter(Boolean).join(' ');
}

/** スタジオ名を含むルールのうち、最も詳しく（長く）書かれたものを使う */
export function findCancelRule(rules: CancelRule[], studio: string): CancelRule | null {
  const hits = rules.filter((r) => studioMatches(r.studio, studio)).sort((a, b) => b.studio.length - a.studio.length);
  return hits[0] ?? null;
}

/** キャンセル期限前警告を出す時刻 */
export function cancelWarningAt(date: string, rule: CancelRule): Date {
  return jstDateTime(addDays(date, -rule.daysBefore), rule.time);
}

export function isActive(p: Practice): boolean {
  return p.status === '募集中' || p.status === '満員';
}

/** LINEのトークで送られた文章が予約内容らしいか（日付と時刻の両方を含む） */
export function looksLikeReservation(text: string): boolean {
  const t = text.replace(/[０-９：／]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const hasTime = /\d{1,2}:\d{2}/.test(t);
  const hasDate = /\d{4}[-/年]\s*\d{1,2}[-/月]\s*\d{1,2}|\d{1,2}\s*[/月]\s*\d{1,2}/.test(t);
  return hasTime && hasDate;
}

/**
 * 予約を「新規／延長／登録済み」に分類する。日時順に見ていき、
 * - 同じ練習IDがあれば登録済み
 * - 既存の練習のすぐ後に続けば、その練習の延長
 * - 同じ登録内の予約のすぐ後に続けば（予約一覧の 19:00-20:30 と 20:30-21:00 など）、その予約にまとめる（料金は合計、どちらか不明なら不明）
 * canExtend で延長してよい既存の練習を絞る（登録する人が延長できない練習の後に続く予約は新規にする）
 */
export function classifyReservations(
  practices: Practice[],
  reservations: Reservation[],
  canExtend: (p: Practice) => boolean,
): DraftItem[] {
  const items: DraftItem[] = [];
  // 判定に使う練習。itemIndex があるものは、この登録で作る（または延長する）items の行
  const running: { p: Practice; itemIndex?: number }[] = practices.filter((p) => p.status !== '中止').map((p) => ({ p: { ...p } }));
  const sorted = [...reservations].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  for (const r of sorted) {
    const id = makePracticeId(r);
    if (running.some((x) => x.p.id === id)) {
      items.push({ reservation: r, kind: 'duplicate', targetId: id });
      continue;
    }
    const prev = running.find(
      (x) =>
        isActive(x.p) &&
        x.p.date === r.date &&
        x.p.studio === r.studio &&
        x.p.room === r.room &&
        x.p.end === r.start &&
        (x.itemIndex != null || canExtend(x.p)),
    );
    if (prev && prev.itemIndex != null) {
      const item = items[prev.itemIndex];
      item.parts = [...(item.parts ?? [{ ...item.reservation }]), { ...r }];
      item.reservation = {
        ...item.reservation,
        end: r.end,
        fee: item.reservation.fee != null && r.fee != null ? item.reservation.fee + r.fee : null,
      };
      prev.p.end = r.end;
      continue;
    }
    if (prev) {
      items.push({ reservation: { ...r }, kind: 'extension', targetId: prev.p.id });
      prev.p.end = r.end;
      prev.itemIndex = items.length - 1;
      continue;
    }
    items.push({ reservation: { ...r }, kind: 'new' });
    running.push({
      p: { ...r, id, fee: r.fee ?? 0, booker: '', max: null, min: null, memo: '', status: '募集中', groups: [], joinKey: '', feeOverride: null, warned: false, createdAt: '' },
      itemIndex: items.length - 1,
    });
  }
  return items;
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

/** 読み取ったうち対象外として除いた予約の件数を1文にする（なければ空文字） */
export function skippedNote({ pastCount, duplicateCount = 0 }: { pastCount: number; duplicateCount?: number }): string {
  const parts = [duplicateCount > 0 && `登録済みの予約情報${duplicateCount}件`, pastCount > 0 && `終了した予約情報${pastCount}件`].filter(Boolean);
  return parts.length ? `${parts.join('・')}は除きました。` : '';
}
