import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { MeView } from '@pb/shared';
import { api } from './api';
import { initLiff } from './liff';
import { DetailPage } from './pages/Detail';
import { ListPage } from './pages/List';
import { RegisterPage } from './pages/Register';
import { AdminPage, SettingsPage } from './pages/Settings';
import './styles.css';
import { AppContext, Spinner, useRoute, useToast } from './ui';

function Router() {
  const { path, query } = useRoute();
  if (path[0] === 'p' && path[1]) return <DetailPage id={path[1]} focusCalendar={query.get('cal') === '1'} />;
  if (path[0] === 'register') return <RegisterPage draftId={query.get('draft')} />;
  if (path[0] === 'settings') return <SettingsPage />;
  if (path[0] === 'admin') return <AdminPage />;
  return <ListPage />;
}

function App() {
  const [me, setMe] = useState<MeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, toastNode] = useToast();

  useEffect(() => {
    (async () => {
      const params = await initLiff();
      // 募集カードや確認カードのリンク（?p= / ?cal= / ?draft=）を画面に振り分ける
      const p = params.get('p');
      const draft = params.get('draft');
      if (p) history.replaceState(null, '', `${location.pathname}#/p/${encodeURIComponent(p)}${params.get('cal') ? '?cal=1' : ''}`);
      else if (draft) history.replaceState(null, '', `${location.pathname}#/register?draft=${encodeURIComponent(draft)}`);
      setMe(await api('me'));
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div class="app">
      {error ? <div class="empty">{error}</div> : me ? <AppContext.Provider value={{ me, setMe, toast }}><Router /></AppContext.Provider> : <Spinner />}
      {toastNode}
    </div>
  );
}

render(<App />, document.getElementById('app')!);
