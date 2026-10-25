import { jstDateTime } from './dates';
import type { Practice } from './types';

export function practiceTitle(p: Pick<Practice, 'studio' | 'room'>): string {
  return `ダンス練習 ${p.studio}${p.room ? ' ' + p.room : ''}`;
}

const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function googleCalendarUrl(p: Practice, detailUrl: string): string {
  const q = [
    ['action', 'TEMPLATE'],
    ['text', practiceTitle(p)],
    ['dates', `${utcStamp(jstDateTime(p.date, p.start))}/${utcStamp(jstDateTime(p.date, p.end))}`],
    ['location', `${p.studio} ${p.room}`.trim()],
    ['details', [p.memo, detailUrl].filter(Boolean).join('\n')],
  ]
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `https://calendar.google.com/calendar/render?${q}`;
}

const escapeIcs = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

export function buildIcs(p: Practice, detailUrl: string, now: Date): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//practice-board//JA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${p.id}@practice-board`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${utcStamp(jstDateTime(p.date, p.start))}`,
    `DTEND:${utcStamp(jstDateTime(p.date, p.end))}`,
    `SUMMARY:${escapeIcs(practiceTitle(p))}`,
    `LOCATION:${escapeIcs(`${p.studio} ${p.room}`.trim())}`,
    `DESCRIPTION:${escapeIcs([p.memo, detailUrl].filter(Boolean).join('\n'))}`,
    `URL:${detailUrl}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:ダンス練習',
    'TRIGGER:-PT2H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}
