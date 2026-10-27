import { createContext, type ComponentChildren } from 'preact';
import { useCallback, useContext, useEffect, useState } from 'preact/hooks';
import { canRegister, weekday, yen, type Answer, type MeView, type PracticeView } from '@studio-attendance/shared';

// ---------------------------------------------------------------- ルーティング（ハッシュ）

export function parseHash(): { path: string[]; query: URLSearchParams } {
  const [p, q = ''] = location.hash.replace(/^#/, '').split('?');
  return { path: p.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q) };
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = () => {
      setRoute(parseHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const go = (path: string) => {
  location.hash = path;
};

// ---------------------------------------------------------------- 共有の状態

interface AppState {
  me: MeView;
  setMe(me: MeView): void;
  toast(msg: string, error?: boolean): void;
  /** 練習の一覧。起動時にまとめて取ったもの（前回の表示のときは practicesAt が 0） */
  practices: PracticeView[] | null;
  practicesAt: number;
  /** 一覧を置き換える。fresh なら「今取った最新」として扱う（一覧に戻っても取り直さない） */
  setPractices(list: PracticeView[], fresh?: boolean): void;
  /** 1件だけ差し替える（出欠や修正の結果をすぐ一覧に反映する） */
  updatePractice(v: PracticeView, opts?: { revert?: boolean }): void;
}

export const AppContext = createContext<AppState>(null as unknown as AppState);
export const useApp = () => useContext(AppContext);

export function useToast() {
  const [toast, setToast] = useState<{ msg: string; error: boolean } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.error ? 4000 : 2200);
    return () => clearTimeout(t);
  }, [toast]);
  const show = useCallback((msg: string, error = false) => setToast({ msg, error }), []);
  const node = toast ? (
    <div class={`toast${toast.error ? ' error' : ''}`} role="status">
      {toast.msg}
    </div>
  ) : null;
  return [show, node] as const;
}

/** 非同期処理を実行し、失敗したらトーストで知らせる */
export function useRunner() {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, done?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        if (done) toast(done);
        return r;
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), true);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return [run, busy] as const;
}

// ---------------------------------------------------------------- アイコン（線画。色は文字色に合わせる）

const ICONS = {
  ticket: 'M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5V14a2 2 0 0 0 0-4zM15 6v2M15 11v2M15 16v2',
  plus: 'M12 5v14M5 12h14',
  send: 'M4 12 20 4l-6 16-3-7zM11 13l9-9',
  chat: 'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4 3.5V17h0a2 2 0 0 1-2-2z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c1-3.6 4-5.5 7.5-5.5s6.5 1.9 7.5 5.5',
  back: 'M15 5l-7 7 7 7',
  chevron: 'M9 5l7 7-7 7',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  camera: 'M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.5-2.5h5L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  text: 'M5 6h14M5 10h14M5 14h9M5 18h6',
  x: 'M6 6l12 12M18 6 6 18',
  calendar: 'M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM4 10h16M8 3v4M16 3v4',
  people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 19.5c.8-3 3.3-4.5 6.5-4.5s5.7 1.5 6.5 4.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 15.2c1.7.6 3 2 3.5 4.3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  pin: 'M12 21s7-6.2 7-11.5a7 7 0 0 0-14 0C5 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  note: 'M6 3.5h9l4 4v13H6zM14.5 3.5V8H19M9 12.5h7M9 16h5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  check: 'M5 12.5 10 17.5 19 7',
} as const;
export type IconName = keyof typeof ICONS;

export const Icon = ({ name, size = 22 }: { name: IconName; size?: number }) => (
  <svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d={ICONS[name]} />
  </svg>
);

// ---------------------------------------------------------------- 部品

export const Spinner = () => <div class="spinner" aria-label="読み込み中" />;

/** 裏で最新に入れ替えている間、画面上端に細い線を流す */
export const Syncing = () => <div class="syncing" role="progressbar" aria-label="更新中" />;

export function TopBar({ title, back, children }: { title?: string; back?: boolean; children?: ComponentChildren }) {
  return (
    <header class="topbar">
      {back && (
        <button class="back-btn" aria-label="戻る" onClick={() => (history.length > 1 ? history.back() : go('/'))}>
          <Icon name="back" size={20} />
        </button>
      )}
      <h1>{title}</h1>
      {children}
    </header>
  );
}

/** 画面上部の文字タブ（下線と縦の区切りだけで切り替える） */
export function Tabs<K extends string>({ items, value, onChange }: { items: { key: K; label: string; count?: number }[]; value: K; onChange: (k: K) => void }) {
  return (
    <div class="tabs" role="tablist">
      {items.map((t) => (
        <button role="tab" aria-selected={t.key === value} onClick={() => onChange(t.key)}>
          {t.label}
          {t.count != null && <span class="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** 画面下の浮いたナビ。どの画面からでも主な画面と要望に移れる */
export function NavBar() {
  const { me } = useApp();
  const { path } = useRoute();
  // 練習の画面は「予定」、募集の画面（/recruit/:id）と登録の画面は「募集」を光らせる
  const here = path[0] === 'p' || path[0] === 'answer' ? '' : path[0] === 'register' ? 'recruit' : (path[0] ?? '');
  const items: { to: string; key: string; icon: IconName; label: string }[] = [
    { to: '/', key: '', icon: 'ticket', label: '予定' },
    ...(canRegister(me.member) ? ([{ to: '/recruit', key: 'recruit', icon: 'send', label: '募集' }] as const) : []),
    { to: '/feedback', key: 'feedback', icon: 'chat', label: '要望' },
    { to: '/settings', key: 'settings', icon: 'user', label: '自分' },
  ];
  const active = here === 'admin' ? 'settings' : here;
  return (
    <nav class="navbar">
      {items.map((it) => (
        <button aria-current={active === it.key ? 'page' : undefined} onClick={() => go(it.to)}>
          <Icon name={it.icon} />
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

const DAY_EN = { 日: 'SUN', 月: 'MON', 火: 'TUE', 水: 'WED', 木: 'THU', 金: 'FRI', 土: 'SAT' } as Record<string, string>;

/** チケットの半券。日付を大きく。行くと決めた練習は黒く反転する */
export function Stub({ date, onClick }: { date: string; onClick?: () => void }) {
  const [, m, d] = date.split('-').map(Number);
  const w = weekday(date);
  return (
    <div class="stub" aria-hidden="true" onClick={onClick}>
      <span class="m">{String(m).padStart(2, '0')}</span>
      <span class="d">{String(d).padStart(2, '0')}</span>
      <span class={`w${w === '土' ? ' sat' : w === '日' ? ' sun' : ''}`}>{DAY_EN[w]}</span>
    </div>
  );
}

export function StatusBadge({ v }: { v: { practice: { status: string } } | PracticeView }) {
  const s = v.practice.status;
  if (s === '中止') return <span class="stamp cancel">中止</span>;
  if (s === '満員') return <span class="stamp full">満員</span>;
  return null;
}

const ANSWER_MARK: Record<Answer, string> = { 行く: '○', 保留: '△', 行かない: '✕' };

/** 出欠。文字は出さず、日本の出欠表どおり ○ △ ✕ の記号だけで選ぶ */
export function RsvpButtons({
  value,
  status,
  onAnswer,
  busy,
  solo,
}: {
  value: Answer | null;
  status: string;
  onAnswer: (a: Answer) => void;
  busy?: boolean;
  /** チケットの外に単独で置く（大きなボタンにする） */
  solo?: boolean;
}) {
  const closed = status === '中止' || status === '終了';
  const full = status === '満員' && value !== '行く';
  return (
    <div class={`rsvp${solo ? ' solo' : ''}`} role="radiogroup" aria-label="出欠">
      {(['行く', '保留', '行かない'] as const).map((a) => (
        <button
          role="radio"
          class={a === '行く' ? 'yes' : a === '保留' ? 'maybe' : 'no'}
          aria-checked={value === a}
          aria-label={a === '行く' && full ? '満員' : a}
          title={a}
          disabled={busy || closed || (a === '行く' && full)}
          onClick={() => value !== a && onAnswer(a)}
        >
          <span class="mark" aria-hidden="true">
            {ANSWER_MARK[a]}
          </span>
        </button>
      ))}
    </div>
  );
}

/** 名前の頭文字の丸。ゲストは点線 */
export const Avatar = ({ name, guest }: { name: string; guest?: boolean }) => (
  <span class={`avatar${guest ? ' guest' : ''}`} aria-hidden="true">
    {[...name.trim()][0] ?? '?'}
  </span>
);

export function AvatarStack({ names, max = 4 }: { names: { name: string; guest?: boolean }[]; max?: number }) {
  if (names.length === 0) return null;
  const rest = names.length - max;
  return (
    <span class="stack" aria-label={names.map((n) => n.name).join('、')}>
      {names.slice(0, max).map((n) => (
        <Avatar name={n.name} guest={n.guest} />
      ))}
      {rest > 0 && <span class="avatar more">+{rest}</span>}
    </span>
  );
}

/** 練習のパス（詳細・参加リンクの画面の先頭）。fields は [ラベル, 値, 補足?, 横いっぱい?] */
export function Pass({
  date,
  status,
  fields,
}: {
  date: string;
  status: string;
  fields: { label: string; value: ComponentChildren; note?: string | null; wide?: boolean; jp?: boolean }[];
}) {
  const [, m, d] = date.split('-').map(Number);
  return (
    <section class="pass" data-status={status}>
      <div class="pass-head">
        <div class="pass-date">
          {String(m).padStart(2, '0')}.{String(d).padStart(2, '0')}
          <span class="w">{DAY_EN[weekday(date)]}</span>
        </div>
        <StatusBadge v={{ practice: { status } }} />
      </div>
      <div class="pass-grid">
        {fields.map((f) => (
          <div class={`fld${f.wide ? ' wide' : ''}`}>
            <span>{f.label}</span>
            <b class={f.jp ? 'jp' : undefined}>{f.value}</b>
            {f.note && <small>{f.note}</small>}
          </div>
        ))}
      </div>
    </section>
  );
}

/** 時間のかかる処理の間、画面を覆って操作できないようにする */
export function BusyOverlay({ message, note }: { message: string; note?: string }) {
  return (
    <div class="overlay" role="alertdialog" aria-busy="true" aria-label={message}>
      <div class="overlay-box">
        <div class="spinner" style={{ margin: '4px auto 14px' }} />
        <strong>{message}</strong>
        {note && <div class="muted">{note}</div>}
      </div>
    </div>
  );
}

/** 一覧のチケットの金額。合計だけを出す（1人あたりは練習の画面で） */
export const Fee = ({ v }: { v: PracticeView }) => (
  <span class="fee">
    <small>計</small>
    {yen(v.practice.fee)}
  </span>
);

export const place = (p: { studio: string; room: string }) => `${p.studio}${p.room ? ' ' + p.room : ''}`;
