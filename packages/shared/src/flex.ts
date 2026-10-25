import { labelDate, shortDate } from './dates';
import { yen } from './practice';
import type { Draft, Group, Practice, Reservation } from './types';

/** LINE Messaging API のメッセージオブジェクト（必要な範囲だけ型付け） */
export type LineMessage = { type: string; [key: string]: unknown };
type Node = Record<string, unknown>;

const GREEN = '#06C755';
const GRAY = '#8C8C8C';
const RED = '#E5484D';

export function appLink(appUrl: string, params: Record<string, string>): string {
  const q = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return q ? `${appUrl}${appUrl.includes('?') ? '&' : '?'}${q}` : appUrl;
}

export function encodePostback(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
}

export function parsePostback(data: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of data.split('&')) {
    const [k, v = ''] = part.split('=');
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

const text = (t: string, extra: Node = {}): Node => ({ type: 'text', text: t || ' ', wrap: true, ...extra });

const row = (label: string, value: string): Node => ({
  type: 'box',
  layout: 'baseline',
  spacing: 'sm',
  contents: [text(label, { size: 'sm', color: GRAY, flex: 2 }), text(value, { size: 'sm', flex: 5 })],
});

const timeRange = (r: { start: string; end: string }) => `${r.start}〜${r.end}`;
const place = (r: { studio: string; room: string }) => `${r.studio}${r.room ? ' ' + r.room : ''}`;

export function practiceSummary(p: Pick<Practice, 'date' | 'start' | 'end' | 'studio' | 'room'>): string {
  return `${labelDate(p.date)} ${timeRange(p)} ${place(p)}`;
}

// ---------------------------------------------------------------- 確認カード

export interface ConfirmCardInput {
  draft: Draft;
  groups: Group[];
  practices: Practice[];
  appUrl: string;
}

export function confirmCard({ draft, groups, practices, appUrl }: ConfirmCardInput): LineMessage {
  const byId = new Map(practices.map((p) => [p.id, p]));
  const itemRows: Node[] = draft.items.map(({ reservation: r, kind, targetId }) => {
    const target = targetId ? byId.get(targetId) : undefined;
    const note =
      kind === 'extension' && target
        ? `${shortDate(target.date)} ${timeRange(target)}の練習の延長として更新（募集は出し直しません）`
        : kind === 'duplicate'
          ? '登録済みです（募集は出しません）'
          : '';
    return {
      type: 'box',
      layout: 'vertical',
      spacing: 'xs',
      contents: [
        text(`${labelDate(r.date)} ${timeRange(r)}`, { weight: 'bold' }),
        text(`${place(r)}　${r.fee != null ? yen(r.fee) : '料金不明'}`, { size: 'sm' }),
        ...(note ? [text(note, { size: 'xs', color: kind === 'duplicate' ? GRAY : GREEN })] : []),
      ],
    };
  });
  if (draft.pastCount > 0) {
    itemRows.push(text(`過去の日付の予約${draft.pastCount}件は除きました。`, { size: 'xs', color: GRAY }));
  }
  if (draft.items.length === 0 && draft.incomplete.length === 0) {
    itemRows.push(text('登録できる今後の予約はありませんでした。', { size: 'sm' }));
  }
  if (draft.incomplete.length > 0) {
    itemRows.push(
      text(`読み取れなかった項目がある予約が${draft.incomplete.length}件あります。「修正して登録」から入力してください。`, {
        size: 'sm',
        color: RED,
      }),
    );
  }
  const groupNames = draft.groups.map((id) => groups.find((g) => g.id === id)?.name ?? '（不明なグループ）');
  // 登録がメイン。グループへの募集は、ふだんの送り先があるときだけ2つ目のボタンで選べる
  const canRegister = draft.incomplete.length === 0 && draft.items.some((i) => i.kind !== 'duplicate');
  const canRecruit = canRegister && draft.groups.length > 0 && draft.items.some((i) => i.kind === 'new');

  const buttons: Node[] = [];
  if (canRegister) {
    buttons.push({
      type: 'button',
      style: 'primary',
      color: GREEN,
      action: { type: 'postback', label: '登録する', data: encodePostback({ a: 'confirm', d: draft.id }), displayText: '登録する' },
    });
  }
  if (canRecruit) {
    buttons.push({
      type: 'button',
      style: 'secondary',
      action: {
        type: 'postback',
        label: '登録してグループに募集',
        data: encodePostback({ a: 'confirm', d: draft.id, r: '1' }),
        displayText: '登録してグループに募集',
      },
    });
  }
  buttons.push(
    {
      type: 'button',
      style: canRegister ? 'link' : 'primary',
      ...(canRegister ? {} : { color: GREEN }),
      action: { type: 'uri', label: '修正して登録', uri: appLink(appUrl, { draft: draft.id }) },
    },
    {
      type: 'button',
      style: 'link',
      action: { type: 'postback', label: 'やめる', data: encodePostback({ a: 'discard', d: draft.id }), displayText: 'やめる' },
    },
  );

  return {
    type: 'flex',
    altText: '読み取った予約内容を確認してください',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          text('予約内容の確認', { weight: 'bold', size: 'lg' }),
          ...itemRows,
          ...(canRecruit
            ? [{ type: 'separator' }, row('募集先', `${groupNames.join('、')}（「登録してグループに募集」のとき）`)]
            : canRegister
              ? [text('グループへの募集は、登録したあとアプリの練習画面からもできます。', { size: 'xs', color: GRAY })]
              : []),
        ],
      },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons },
    },
  };
}

// ---------------------------------------------------------------- 募集カード

export interface RecruitInput {
  practice: Practice;
  bookerName: string;
  /** 部屋の広さなどの補足 */
  roomInfo?: string | null;
}

function recruitBubble({ practice: p, bookerName, roomInfo }: RecruitInput, appUrl: string): Node {
  const d = shortDate(p.date);
  return {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        text('練習募集', { size: 'xs', color: GREEN, weight: 'bold' }),
        text(labelDate(p.date), { weight: 'bold', size: 'xl' }),
        text(timeRange(p), { size: 'md' }),
        { type: 'separator', margin: 'md' },
        row('場所', place(p)),
        ...(roomInfo ? [row('広さ', roomInfo)] : []),
        row('予約者', bookerName),
        row('料金', `${yen(p.fee)}を参加人数で割り勘`),
        ...(p.max ? [row('上限', `${p.max}人`)] : []),
        ...(p.memo ? [row('メモ', p.memo)] : []),
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          spacing: 'sm',
          contents: [
            {
              type: 'button',
              style: 'primary',
              color: GREEN,
              height: 'sm',
              action: { type: 'postback', label: '行く', data: encodePostback({ a: 'rsvp', p: p.id, v: '1' }), displayText: `${d} 行きます` },
            },
            {
              type: 'button',
              style: 'secondary',
              height: 'sm',
              action: { type: 'postback', label: '保留', data: encodePostback({ a: 'rsvp', p: p.id, v: '2' }), displayText: `${d} 保留にします` },
            },
            {
              type: 'button',
              style: 'secondary',
              height: 'sm',
              action: { type: 'postback', label: '行かない', data: encodePostback({ a: 'rsvp', p: p.id, v: '0' }), displayText: `${d} 行きません` },
            },
          ],
        },
        {
          type: 'button',
          style: 'link',
          height: 'sm',
          action: { type: 'uri', label: 'カレンダーに追加', uri: appLink(appUrl, { p: p.id, cal: '1' }) },
        },
        {
          type: 'button',
          style: 'link',
          height: 'sm',
          action: { type: 'uri', label: '参加状況を見る', uri: appLink(appUrl, { p: p.id }) },
        },
      ],
    },
  };
}

/** 1回の登録につき1メッセージ（カルーセルは12枚まで。超えたら複数メッセージに分ける） */
export function recruitMessages(items: RecruitInput[], appUrl: string): LineMessage[] {
  const messages: LineMessage[] = [];
  for (let i = 0; i < items.length; i += 12) {
    const chunk = items.slice(i, i + 12);
    const dates = chunk.map((c) => labelDate(c.practice.date)).join('・');
    messages.push({
      type: 'flex',
      altText: `練習募集: ${dates}`,
      contents: { type: 'carousel', contents: chunk.map((c) => recruitBubble(c, appUrl)) },
    });
  }
  return messages;
}

// ---------------------------------------------------------------- 練習一覧（「練習」への応答）

export interface ListItem {
  practice: Practice;
  going: number;
}

export function practiceListMessage(items: ListItem[], appUrl: string): LineMessage {
  if (items.length === 0) {
    return { type: 'text', text: `今後の練習はまだありません。\n${appUrl}` };
  }
  const shown = items.slice(0, 10);
  const rows: Node[] = shown.map(({ practice: p, going }) => ({
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    action: { type: 'uri', label: '詳細', uri: appLink(appUrl, { p: p.id }) },
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        flex: 5,
        contents: [
          text(`${labelDate(p.date)} ${timeRange(p)}`, { size: 'sm', weight: 'bold' }),
          text(place(p), { size: 'xs', color: GRAY }),
        ],
      },
      text(p.status === '満員' ? `${going}人 満員` : `${going}人`, {
        size: 'sm',
        flex: 2,
        align: 'end',
        gravity: 'center',
        color: p.status === '満員' ? RED : '#111111',
      }),
    ],
  }));
  if (items.length > shown.length) rows.push(text(`ほか${items.length - shown.length}件`, { size: 'xs', color: GRAY }));
  return {
    type: 'flex',
    altText: '今後の練習',
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [text('今後の練習', { weight: 'bold', size: 'lg' }), ...rows] },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'button', style: 'primary', color: GREEN, action: { type: 'uri', label: 'アプリで見る', uri: appUrl } }],
      },
    },
  };
}

// ---------------------------------------------------------------- テキスト通知

export function cancelText(p: Practice): string {
  return `【中止】${practiceSummary(p)} の練習は中止になりました。`;
}

export function warningText(p: Practice, going: number, min: number, appUrl: string): string {
  return [
    `${practiceSummary(p)} の参加は現在${going}人です（最低人数${min}人）。`,
    'まもなくキャンセル料がかかります。キャンセルするか判断してください。',
    appLink(appUrl, { p: p.id }),
  ].join('\n');
}

export function reservationLabel(r: Reservation): string {
  return practiceSummary(r);
}
