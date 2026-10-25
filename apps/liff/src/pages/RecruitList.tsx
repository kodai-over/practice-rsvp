import { useEffect, useState } from 'preact/hooks';
import { labelDate, type PracticeView } from '@pb/shared';
import { api } from '../api';
import { RoomInfo } from '../components/StudioRoom';
import { Spinner, TopBar, go, place, useApp, useRunner } from '../ui';

/** メニューの「募集する」。自分が登録した（管理者はすべての）練習から、募集を送る練習を選ぶ */
export function RecruitListPage() {
  const { me } = useApp();
  const [list, setList] = useState<PracticeView[] | null>(null);
  const [run] = useRunner();

  useEffect(() => {
    run(() => api('listPractices')).then(
      (r) => r && setList(r.filter((v) => v.canEdit && (v.practice.status === '募集中' || v.practice.status === '満員'))),
    );
  }, []);

  return (
    <>
      <TopBar title="募集する" back />
      <p class="muted" style={{ marginTop: 0 }}>
        募集を送る練習を選んでください。グループを選んで「募集を送る」を押すと、募集メッセージが流れます。
      </p>
      {list == null ? (
        <Spinner />
      ) : list.length === 0 ? (
        <div class="empty">
          募集を送れる練習がありません。
          <br />
          <button class="btn primary" style={{ marginTop: 12 }} onClick={() => go('/register')}>
            ＋ 練習を登録
          </button>
        </div>
      ) : (
        list.map((v) => {
          const p = v.practice;
          const rest = me.groups.filter((g) => !p.groups.includes(g.id)).length;
          return (
            <button class="card link" style={{ display: 'block', width: '100%', textAlign: 'left', border: 0 }} onClick={() => go(`/p/${encodeURIComponent(p.id)}?recruit=1`)}>
              <div class="row">
                <strong class="grow">
                  {labelDate(p.date)} {p.start}〜{p.end}
                </strong>
                <span class={`badge ${v.groupNames.length ? 'mine' : 'todo'}`}>{v.groupNames.length ? '募集済み' : '未募集'}</span>
              </div>
              <div class="place">{place(p)}</div>
              <RoomInfo studios={me.settings.studios} studio={p.studio} room={p.room} />
              <div class="muted" style={{ marginTop: 4 }}>
                {v.groupNames.length ? `募集先: ${v.groupNames.join('、')}` : 'まだどのグループにも募集していません'}
                {v.groupNames.length > 0 && rest > 0 ? `（ほか${rest}グループに送れます）` : ''}
              </div>
            </button>
          );
        })
      )}
    </>
  );
}
