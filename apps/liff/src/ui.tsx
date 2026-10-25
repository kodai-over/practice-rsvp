import { createContext, type ComponentChildren } from 'preact';
import { useCallback, useContext, useEffect, useState } from 'preact/hooks';
import { shortDate, weekday, yen, type Answer, type MeView, type PracticeView } from '@pb/shared';

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

// ---------------------------------------------------------------- 部品

export const Spinner = () => <div class="spinner" aria-label="読み込み中" />;

export function TopBar({ title, back, children }: { title: string; back?: boolean; children?: ComponentChildren }) {
  return (
    <header class="topbar">
      {back && (
        <button class="back" onClick={() => (history.length > 1 ? history.back() : go('/'))}>
          ‹ 戻る
        </button>
      )}
      <h1>{title}</h1>
      {children}
    </header>
  );
}

export function DateBlock({ date }: { date: string }) {
  const [, m, d] = date.split('-').map(Number);
  const w = weekday(date);
  return (
    <div class="date-block" aria-label={shortDate(date)}>
      <div class="m">{m}月</div>
      <div class="d">{d}</div>
      <div class={`w${w === '土' ? ' sat' : w === '日' ? ' sun' : ''}`}>{w}</div>
    </div>
  );
}

export function StatusBadge({ v }: { v: PracticeView }) {
  if (v.practice.status === '中止') return <span class="badge cancel">中止</span>;
  if (v.practice.status === '満員') return <span class="badge full">満員</span>;
  return null;
}

export function RsvpButtons({ v, onAnswer, busy }: { v: PracticeView; onAnswer: (a: Answer) => void; busy?: boolean }) {
  const closed = v.practice.status === '中止' || v.practice.status === '終了';
  const full = v.practice.status === '満員' && v.myAnswer !== '行く';
  return (
    <div class="rsvp">
      <button class="yes" aria-pressed={v.myAnswer === '行く'} disabled={busy || closed || full} onClick={() => onAnswer('行く')}>
        {full ? '満員' : '行く'}
      </button>
      <button class="no" aria-pressed={v.myAnswer === '行かない'} disabled={busy || closed} onClick={() => onAnswer('行かない')}>
        行かない
      </button>
    </div>
  );
}

export const feeLabel = (v: PracticeView) => (v.perPerson != null ? `1人 ${yen(v.perPerson)}` : `計 ${yen(v.practice.fee)}`);

export const place = (p: { studio: string; room: string }) => `${p.studio}${p.room ? ' ' + p.room : ''}`;
