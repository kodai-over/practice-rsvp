/** 参加リンクのページ。LINEを使わない人が名前を入れて出欠を出す */
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { yen, type Answer, type JoinView } from '@studio-attendance/shared';
import { joinApi } from './api';
import './styles.css';
import { Pass, RsvpButtons, Spinner, useToast } from './ui';

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
      toast(`「${a}」で回答しました`);
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
        <h1>RSVP</h1>
      </header>
      <Pass
        date={v.date}
        status={v.status}
        fields={[
          { label: 'TIME', value: `${v.start}–${v.end}`, wide: true },
          { label: 'STUDIO', value: v.studio, jp: true, wide: !v.room },
          ...(v.room ? [{ label: 'ROOM', value: v.room, note: v.roomInfo, jp: true }] : []),
          { label: 'GOING', value: v.goingCount },
          { label: 'PER PERSON', value: v.perPerson != null ? yen(v.perPerson) : '—' },
          ...(v.memo ? [{ label: 'MEMO', value: v.memo, jp: true, wide: true }] : []),
        ]}
      />

      {!closed && (
        <>
          <input type="text" value={name} maxLength={30} aria-label="名前" placeholder="名前" style={{ marginBottom: 12 }} onInput={(e) => setName(e.currentTarget.value)} />
          <RsvpButtons solo value={v.myAnswer} status={v.status} busy={busy} onAnswer={answer} />
          <p class="muted" style={{ textAlign: 'center' }}>LINE不要・押し直しで変更できます</p>
        </>
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
