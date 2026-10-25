/** 参加リンクのページ。LINEを使わない人が名前を入れて出欠を出す */
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { labelDate, yen, type Answer, type JoinView } from '@pb/shared';
import { joinApi } from './api';
import './styles.css';
import { Spinner, place, useToast } from './ui';

const q = new URLSearchParams(location.search);
const id = q.get('p') ?? '';
const key = q.get('k') ?? '';
const NAME_KEY = 'pb:name';
const pidKey = `pb:join:${id}`;

const load = (k: string) => {
  try {
    return localStorage.getItem(k) ?? '';
  } catch {
    return '';
  }
};
const save = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* 保存できなくても回答はできる */
  }
};

function JoinPage() {
  const [v, setV] = useState<JoinView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(() => load(NAME_KEY));
  const [busy, setBusy] = useState(false);
  const [toast, toastNode] = useToast();

  useEffect(() => {
    joinApi('get', { id, key, participant: load(pidKey) || undefined })
      .then(setV)
      .catch((e) => setError(e.message));
  }, []);

  const answer = async (a: Answer) => {
    if (!name.trim()) return toast('名前を入力してください', true);
    setBusy(true);
    try {
      const r = await joinApi('answer', { id, key, name: name.trim(), answer: a, participant: load(pidKey) || undefined });
      save(NAME_KEY, name.trim());
      save(pidKey, r.participant);
      setV(r);
      toast(a === '行く' ? '「行く」で登録しました' : '「行かない」で登録しました');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div class="empty">{error}</div>;
  if (!v) return <Spinner />;
  const closed = v.status === '中止';

  return (
    <>
      <header class="topbar">
        <h1>練習の出欠</h1>
      </header>
      <section class="card">
        <div style={{ fontSize: 22, fontWeight: 800 }}>{labelDate(v.date)}</div>
        <div class="time">
          {v.start}〜{v.end}
          {v.status === '満員' && <span class="badge full">満員</span>}
          {closed && <span class="badge cancel">中止</span>}
        </div>
        <div class="place">{place(v)}</div>
        {v.roomInfo && <div class="room-info">{v.roomInfo}</div>}
        <div class="meta">
          <span>
            参加 <strong>{v.goingCount}人</strong>
          </span>
          {v.perPerson != null && (
            <span>
              1人あたり <strong>{yen(v.perPerson)}</strong>
            </span>
          )}
        </div>
        {v.memo && <div class="memo" style={{ marginTop: 8 }}>{v.memo}</div>}
      </section>

      {closed ? (
        <div class="empty">この練習は中止になりました</div>
      ) : (
        <section class="card">
          <label class="field">
            <span>お名前</span>
            <input type="text" value={name} maxLength={30} placeholder="例：山田はなこ" onInput={(e) => setName(e.currentTarget.value)} />
          </label>
          <div class="rsvp">
            <button class="yes" aria-pressed={v.myAnswer === '行く'} disabled={busy || (v.status === '満員' && v.myAnswer !== '行く')} onClick={() => answer('行く')}>
              行く
            </button>
            <button class="no" aria-pressed={v.myAnswer === '行かない'} disabled={busy} onClick={() => answer('行かない')}>
              行かない
            </button>
          </div>
          <p class="muted">LINEの登録は要りません。同じ端末から押し直すと回答を変えられます。</p>
        </section>
      )}
      {toastNode}
    </>
  );
}

render(
  <div class="app">
    <JoinPage />
  </div>,
  document.getElementById('app')!,
);
