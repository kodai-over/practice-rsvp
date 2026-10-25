import { useEffect, useState } from 'preact/hooks';
import { FEEDBACK_STATUSES, isAdmin, toJstDate, type FeedbackStatus, type FeedbackView } from '@pb/shared';
import { api } from '../api';
import { Spinner, TopBar, useApp, useRunner } from '../ui';

const STATUS_CLASS: Record<FeedbackStatus, string> = {
  未対応: 'todo',
  検討中: 'mine',
  改善済み: 'mine',
  見送り: 'cancel',
};

export function FeedbackPage() {
  const { me } = useApp();
  const [list, setList] = useState<FeedbackView[] | null>(null);
  const [text, setText] = useState('');
  const [run, busy] = useRunner();
  const admin = isAdmin(me.member);

  useEffect(() => {
    run(() => api('listFeedback')).then((r) => r && setList(r));
  }, []);

  const post = async (e: Event) => {
    e.preventDefault();
    const r = await run(() => api('postFeedback', { text }), '要望を送りました。ありがとうございます！');
    if (r) {
      setList(r);
      setText('');
    }
  };

  return (
    <>
      <TopBar title="改善要望" back />
      <form class="card" onSubmit={post}>
        <label class="field">
          <span>こうなったら便利、ここが使いにくい、など何でも</span>
          <textarea rows={3} maxLength={1000} value={text} placeholder="例：練習の前日にリマインドがほしい" onInput={(e) => setText(e.currentTarget.value)} />
        </label>
        <div class="row">
          <span class="muted grow">投稿すると、名前（{me.member.name}）と一緒にメンバー全員に表示されます</span>
          <button class="btn primary" disabled={busy || !text.trim()}>
            送る
          </button>
        </div>
      </form>

      <div class="section-title">みんなの要望</div>
      {list == null ? (
        <Spinner />
      ) : list.length === 0 ? (
        <div class="empty">まだ要望はありません</div>
      ) : (
        list.map((f) => <FeedbackCard key={f.id} f={f} admin={admin} busy={busy} onChange={setList} run={run} />)
      )}
    </>
  );
}

function FeedbackCard({
  f,
  admin,
  busy,
  onChange,
  run,
}: {
  f: FeedbackView;
  admin: boolean;
  busy: boolean;
  onChange: (l: FeedbackView[]) => void;
  run: ReturnType<typeof useRunner>[0];
}) {
  const [reply, setReply] = useState(f.reply);
  const update = async (params: { status?: FeedbackStatus; reply?: string }) => {
    const r = await run(() => api('updateFeedback', { id: f.id, ...params }), '更新しました');
    if (r) onChange(r);
  };

  return (
    <article class="card">
      <div class="row">
        <strong class="grow">{f.name}{f.mine && <span class="muted">（自分）</span>}</strong>
        <span class={`badge ${STATUS_CLASS[f.status]}`}>{f.status}</span>
      </div>
      <div class="memo" style={{ marginTop: 6 }}>{f.text}</div>
      <div class="muted" style={{ marginTop: 4 }}>{f.createdAt ? toJstDate(new Date(f.createdAt)).replace(/-/g, '/') : ''}</div>
      {f.reply && !admin && (
        <div class="memo" style={{ marginTop: 8, padding: 8, borderRadius: 8, background: 'var(--chip)' }}>
          管理者より：{f.reply}
        </div>
      )}
      {admin && (
        <div style={{ marginTop: 10 }}>
          <div class="row">
            <select style={{ width: 'auto' }} value={f.status} disabled={busy} onChange={(e) => update({ status: e.currentTarget.value as FeedbackStatus })}>
              {FEEDBACK_STATUSES.map((s) => (
                <option>{s}</option>
              ))}
            </select>
            <input type="text" class="grow" placeholder="コメント（全員に表示）" value={reply} onInput={(e) => setReply(e.currentTarget.value)} />
            <button class="btn small" disabled={busy || reply === f.reply} onClick={() => update({ reply })}>
              保存
            </button>
          </div>
        </div>
      )}
      {f.canDelete && (
        <button
          class="btn small danger"
          style={{ marginTop: 8 }}
          disabled={busy}
          onClick={async () => {
            if (!confirm('この要望を削除しますか？')) return;
            const r = await run(() => api('deleteFeedback', { id: f.id }), '削除しました');
            if (r) onChange(r);
          }}
        >
          削除
        </button>
      )}
    </article>
  );
}
