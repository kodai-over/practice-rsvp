const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Date を日本時間の 'YYYY-MM-DD' に */
export function toJstDate(d: Date): string {
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  return `${j.getUTCFullYear()}-${pad(j.getUTCMonth() + 1)}-${pad(j.getUTCDate())}`;
}

/** Date を日本時間の 'HH:mm' に */
export function toJstTime(d: Date): string {
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  return `${pad(j.getUTCHours())}:${pad(j.getUTCMinutes())}`;
}

/** 日本時間の日付と時刻から Date を作る */
export function jstDateTime(date: string, time = '00:00'): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - JST_OFFSET_MS);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function weekday(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** '2026-10-21' → '10/21' */
export function shortDate(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
}

/** '2026-10-21' → '10/21(水)' */
export function labelDate(date: string): string {
  return `${shortDate(date)}(${weekday(date)})`;
}

export function isValidDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** 'H:mm' や 'HH:mm' を受け付け、'24:00' 以降（深夜利用）も許す */
export function normalizeTime(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{1,2})[:：](\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 29 || mm > 59) return null;
  return `${pad(hh)}:${pad(mm)}`;
}

export function minutes(time: string): number {
  const [hh, mm] = time.split(':').map(Number);
  return hh * 60 + mm;
}

/** n番目の月曜日（ハッピーマンデー）の日 */
function nthMonday(y: number, m: number, n: number): number {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return 1 + ((8 - first) % 7) + (n - 1) * 7;
}

const holidayCache = new Map<number, Set<string>>();

/** その年の日本の祝日（振替休日・国民の休日を含む）。2000〜2099年の決まりで計算する */
export function jpHolidays(y: number): Set<string> {
  const cached = holidayCache.get(y);
  if (cached) return cached;
  const ymd = (m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
  const days = [
    ymd(1, 1),
    ymd(1, nthMonday(y, 1, 2)), // 成人の日
    ymd(2, 11),
    ymd(2, 23),
    ymd(3, Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4))), // 春分の日
    ymd(4, 29),
    ymd(5, 3),
    ymd(5, 4),
    ymd(5, 5),
    ymd(7, nthMonday(y, 7, 3)), // 海の日
    ymd(8, 11),
    ymd(9, nthMonday(y, 9, 3)), // 敬老の日
    ymd(9, Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4))), // 秋分の日
    ymd(10, nthMonday(y, 10, 2)), // スポーツの日
    ymd(11, 3),
    ymd(11, 23),
  ];
  const set = new Set(days);
  // 国民の休日（祝日にはさまれた平日）
  for (const d of days) {
    const next = addDays(d, 2);
    if (set.has(next) && !set.has(addDays(d, 1)) && weekday(addDays(d, 1)) !== '日') set.add(addDays(d, 1));
  }
  // 振替休日（日曜の祝日の後の、最初の祝日でない日）
  for (const d of [...set].sort()) {
    if (weekday(d) !== '日') continue;
    let sub = addDays(d, 1);
    while (set.has(sub)) sub = addDays(sub, 1);
    set.add(sub);
  }
  holidayCache.set(y, set);
  return set;
}

/** 土日・祝日なら true */
export function isHolidayOrWeekend(date: string): boolean {
  const w = weekday(date);
  return w === '土' || w === '日' || jpHolidays(Number(date.slice(0, 4))).has(date);
}
