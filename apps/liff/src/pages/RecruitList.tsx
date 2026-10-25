import { useEffect, useState } from 'preact/hooks';
import { labelDate } from '@pb/shared';
import { api } from '../api';
import { Icon, Spinner, Stub, TopBar, go, place, useApp, useRunner } from '../ui';

/** メニューの「募集する」。自分が登録した（管理者はすべての）練習から、募集を送る練習を選ぶ */
export function RecruitListPage() {
  const { me, practices, setPractices } = useApp();
  const [run] = useRunner();
  const [fresh, setFresh] = useState(false);

  // 手元の一覧ですぐ表示し、最新の一覧は裏で取り直す
  useEffect(() => {
    run(() => api('listPractices')).then((r) => {
      if (r) setPractices(r, true);
      setFresh(true);
    });
  }, []);

  const list = practices == null && !fresh ? null : (practices ?? []).filter((v) => v.canEdit && (v.practice.status === '募集中' || v.practice.status === '満員'));

  return (
    <>
      <TopBar title="募集" />
      {list == null ? (
        <Spinner />
      ) : list.length === 0 ? (
        <div class="empty">
          <div class="empty-mark">—</div>
          募集できる練習なし
          <button class="btn primary" onClick={() => go('/register')}>
            <Icon name="plus" size={18} />
            登録
          </button>
        </div>
      ) : (
        list.map((v) => {
          const p = v.practice;
          const open = () => go(`/p/${encodeURIComponent(p.id)}?recruit=1`);
          const sent = v.groupNames.length > 0;
          return (
            <article class="ticket" data-answer={sent ? 'sent' : 'none'}>
              <Stub date={p.date} onClick={open} />
              <button class="ticket-main" onClick={open}>
                <span class="sr">{labelDate(p.date)}</span>
                <div class="time">
                  {p.start}–{p.end}
                  <span class={`stamp ${sent ? 'ok' : 'todo'}`}>{sent ? '募集済' : '未募集'}</span>
                </div>
                <div class="place">{place(p)}</div>
                <div class="ticket-foot">
                  <span class="toggles">
                    {me.groups.map((g) => (
                      <span class={`tag${p.groups.includes(g.id) ? '' : ' soft'}`}>{g.name}</span>
                    ))}
                  </span>
                  <span class="fee">
                    <Icon name="chevron" size={18} />
                  </span>
                </div>
              </button>
            </article>
          );
        })
      )}
    </>
  );
}
