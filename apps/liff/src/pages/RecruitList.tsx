import { useEffect, useState } from 'preact/hooks';
import { labelDate } from '@studio-attendance/shared';
import { api } from '../api';
import { Icon, Spinner, Stub, TopBar, go, place, useApp, useRunner } from '../ui';

/**
 * 「募集」。自分が登録した受付中の練習を並べ、押すと募集・ゲスト追加・参加リンクの画面へ。右上の＋から登録する。
 * 他の人の練習は、予定から練習を開いて「募集・ゲスト」から
 */
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

  const list =
    practices == null && !fresh
      ? null
      : (practices ?? []).filter((v) => v.practice.booker === me.member.userId && (v.practice.status === '募集中' || v.practice.status === '満員'));

  return (
    <>
      <TopBar title="募集">
        <button class="icon-btn" aria-label="チケットを登録" onClick={() => go('/register')}>
          <Icon name="plus" />
        </button>
      </TopBar>
      {list == null ? (
        <Spinner />
      ) : list.length === 0 ? (
        <div class="empty">
          登録した練習はありません
          <button class="btn primary" onClick={() => go('/register')}>
            <Icon name="plus" size={18} />
            登録
          </button>
        </div>
      ) : (
        list.map((v) => {
          const p = v.practice;
          const open = () => go(`/recruit/${encodeURIComponent(p.id)}`);
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
