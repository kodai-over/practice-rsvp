import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { HomeView, MeView, PracticeView } from '@studio-attendance/shared';
import { api } from './api';
import { initLiff } from './liff';
import { DetailPage } from './pages/Detail';
import { FeedbackPage } from './pages/Feedback';
import { ListPage } from './pages/List';
import { RecruitDetailPage } from './pages/RecruitDetail';
import { RecruitListPage } from './pages/RecruitList';
import { RegisterPage } from './pages/Register';
import { AdminPage, SettingsPage } from './pages/Settings';
import './styles.css';
import { AppContext, NavBar, Spinner, useRoute, useToast } from './ui';

function Router() {
  const { path, query } = useRoute();
  if (path[0] === 'p' && path[1]) return <DetailPage id={path[1]} focus={query.get('cal') === '1' ? 'calendar' : null} />;
  if (path[0] === 'recruit' && path[1]) return <RecruitDetailPage id={path[1]} />;
  if (path[0] === 'recruit') return <RecruitListPage />;
  if (path[0] === 'register') return <RegisterPage draftId={query.get('draft')} />;
  if (path[0] === 'settings') return <SettingsPage />;
  if (path[0] === 'admin') return <AdminPage />;
  if (path[0] === 'feedback') return <FeedbackPage />;
  return <ListPage initialTab={query.get('tab')} />;
}

const CACHE_KEY = 'pb:home';

/** 前回開いたときの表示。開いた瞬間に出し、裏で最新に入れ替える */
function loadCache(): HomeView | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as HomeView) : null;
  } catch {
    return null;
  }
}

function saveCache(h: HomeView) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(h));
  } catch {
    /* 保存できなくても動く */
  }
}

function App() {
  const [cached] = useState(loadCache);
  const [me, setMe] = useState<MeView | null>(cached?.me ?? null);
  const [practices, setPracticesState] = useState<{ list: PracticeView[]; at: number } | null>(cached ? { list: cached.practices, at: 0 } : null);
  const [error, setError] = useState<string | null>(null);
  const [toast, toastNode] = useToast();

  useEffect(() => {
    (async () => {
      const params = await initLiff();
      // 募集カードや確認カードのリンク（?p= / ?cal= / ?draft=）を画面に振り分ける
      // ?view= は以前のメニュー（4つのボタン）のリンク。古いリンクから開かれても困らないよう残す
      const p = params.get('p');
      const draft = params.get('draft');
      // グループのカードから開いたときは、先にそのグループのメンバーとして覚えてもらう（でないと練習が見えない）
      const group = params.get('g');
      const key = params.get('k');
      if (group && key) await api('openedFromGroup', { group, key }).catch(() => null);
      const views: Record<string, string> = { register: '/register', recruit: '/recruit', mine: '/?tab=mine', feedback: '/feedback' };
      const view = views[params.get('view') ?? ''];
      const hash = p
        ? `/p/${encodeURIComponent(p)}${params.get('cal') ? '?cal=1' : ''}`
        : draft
          ? `/register?draft=${encodeURIComponent(draft)}`
          : view;
      if (hash) {
        history.replaceState(null, '', `${location.pathname}#${hash}`);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
      const home = await api('home');
      setMe(home.me);
      setPracticesState({ list: home.practices, at: Date.now() });
      saveCache(home);
    })().catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      if (cached) toast(msg, true);
      else setError(msg);
    });
  }, []);

  const setPractices = (list: PracticeView[], fresh = false) => setPracticesState((cur) => ({ list, at: fresh ? Date.now() : cur?.at || Date.now() }));
  const updatePractice = (v: PracticeView) =>
    setPracticesState((cur) => {
      if (!cur) return cur;
      const has = cur.list.some((x) => x.practice.id === v.practice.id);
      return { ...cur, list: has ? cur.list.map((x) => (x.practice.id === v.practice.id ? v : x)) : [...cur.list, v] };
    });

  return (
    <div class="app">
      {error ? (
        <div class="empty">{error}</div>
      ) : me ? (
        <AppContext.Provider value={{ me, setMe, toast, practices: practices?.list ?? null, practicesAt: practices?.at ?? 0, setPractices, updatePractice }}>
          <Router />
          <NavBar />
        </AppContext.Provider>
      ) : (
        <Spinner />
      )}
      {toastNode}
    </div>
  );
}

render(<App />, document.getElementById('app')!);
