import { useEffect, useState } from 'preact/hooks';
import { canRegister, labelDate, type Answer, type PracticeView } from '@studio-attendance/shared';
import { api } from '../api';
import { AvatarStack, Fee, Icon, RsvpButtons, Spinner, StatusBadge, Stub, Syncing, Tabs, go, place, useApp, useRunner } from '../ui';

type Tab = 'all' | 'mine' | 'todo';
const TAB_KEY = 'pb:tab';

function readTab(): Tab {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return t === 'mine' || t === 'todo' ? t : 'all';
  } catch {
    return 'all';
  }
}

export function ListPage({ initialTab }: { initialTab?: string | null }) {
  const { me, practices: list, practicesAt, setPractices, updatePractice } = useApp();
  const [tab, setTab] = useState<Tab>(() => (initialTab === 'mine' || initialTab === 'todo' || initialTab === 'all' ? initialTab : readTab()));
  const [run, busy] = useRunner();

  useEffect(() => {
    // 起動時のまとめ取得から時間がたっていれば取り直す（前回の表示のときは起動処理が取り直すので待つ）
    if (practicesAt > 0 && Date.now() - practicesAt > 30_000) run(() => api('listPractices')).then((r) => r && setPractices(r));
  }, []);

  const selectTab = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* 保存できなくても動く */
    }
  };

  // 押した瞬間に色を変え、サーバーの結果が来たら人数なども含めて差し替える（失敗したら元に戻す）
  const answer = async (id: string, a: Answer) => {
    const before = (list ?? []).find((x) => x.practice.id === id);
    if (before) updatePractice({ ...before, myAnswer: a });
    const v = await run(() => api('rsvp', { id, answer: a }));
    if (v) updatePractice(v);
    else if (before) updatePractice(before);
  };

  const active = (list ?? []).filter((v) => v.practice.status !== '中止');
  const groups: Record<Tab, PracticeView[]> = {
    all: list ?? [],
    mine: active.filter((v) => v.myAnswer === '行く'),
    todo: active.filter((v) => v.myAnswer == null || v.myAnswer === '保留'),
  };
  const shown = groups[tab];

  return (
    <>
      <header class="tabs-head">
        <Tabs
          value={tab}
          onChange={selectTab}
          items={[
            { key: 'all', label: 'すべて', count: list ? groups.all.length : undefined },
            { key: 'mine', label: '行く', count: list ? groups.mine.length : undefined },
            { key: 'todo', label: '未定', count: list ? groups.todo.length : undefined },
          ]}
        />
        {(practicesAt === 0 || busy) && <Syncing />}
      </header>

      {list == null ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <div class="empty">
          <div>{tab === 'todo' ? '未定の練習はありません' : tab === 'mine' ? '行く練習はありません' : '練習はありません'}</div>
          {tab === 'all' && canRegister(me.member) && (
            <button class="btn primary" onClick={() => go('/register')}>
              <Icon name="plus" size={18} />
              登録
            </button>
          )}
        </div>
      ) : (
        shown.map((v) => <PracticeCard key={v.practice.id} v={v} onAnswer={(a) => answer(v.practice.id, a)} />)
      )}
    </>
  );
}

function PracticeCard({ v, onAnswer }: { v: PracticeView; onAnswer: (a: Answer) => void }) {
  const p = v.practice;
  const open = () => go(`/p/${encodeURIComponent(p.id)}`);
  return (
    <article class="ticket" data-answer={v.myAnswer ?? 'none'} data-status={p.status}>
      <Stub date={p.date} onClick={open} />
      <button class="ticket-main" onClick={open}>
        <span class="sr">{labelDate(p.date)}</span>
        <div class="time">
          {p.start}–{p.end}
          <StatusBadge v={v} />
        </div>
        <div class="place">{place(p)}</div>
        <div class="ticket-foot">
          <AvatarStack names={v.going.map((a) => ({ name: a.name, guest: a.kind === 'ゲスト' }))} />
          <span class="count">
            <Icon name="people" size={16} />
            {v.goingCount}
            {p.max ? <small>/{p.max}</small> : null}
          </span>
          <Fee v={v} />
        </div>
      </button>
      <RsvpButtons value={v.myAnswer} status={p.status} onAnswer={onAnswer} />
    </article>
  );
}
