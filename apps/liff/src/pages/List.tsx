import { useEffect, useState } from 'preact/hooks';
import { canRegister, type Answer, type PracticeView } from '@pb/shared';
import { api } from '../api';
import { DateBlock, RsvpButtons, Spinner, StatusBadge, TopBar, feeLabel, go, place, useApp, useRunner } from '../ui';

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

export function ListPage() {
  const { me } = useApp();
  const [list, setList] = useState<PracticeView[] | null>(null);
  const [tab, setTab] = useState<Tab>(readTab);
  const [run, busy] = useRunner();

  useEffect(() => {
    run(() => api('listPractices')).then((r) => r && setList(r));
  }, []);

  const selectTab = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* 保存できなくても動く */
    }
  };

  const answer = async (id: string, a: Answer) => {
    const v = await run(() => api('rsvp', { id, answer: a }));
    if (v) setList((l) => l!.map((x) => (x.practice.id === id ? v : x)));
  };

  const active = (list ?? []).filter((v) => v.practice.status !== '中止');
  const groups: Record<Tab, PracticeView[]> = {
    all: list ?? [],
    mine: active.filter((v) => v.myAnswer === '行く'),
    todo: active.filter((v) => v.myAnswer == null),
  };
  const shown = groups[tab];

  return (
    <>
      <TopBar title="練習">
        {canRegister(me.member) && (
          <button class="btn primary small" onClick={() => go('/register')}>
            ＋ 練習を登録
          </button>
        )}
        <button class="icon-btn" onClick={() => go('/settings')} aria-label="設定">
          設定
        </button>
      </TopBar>

      <div class="tabs" role="tablist">
        {(
          [
            ['all', 'すべて'],
            ['mine', '自分が行く'],
            ['todo', '未回答'],
          ] as const
        ).map(([k, label]) => (
          <button role="tab" aria-selected={tab === k} onClick={() => selectTab(k)}>
            {label}
            {list && <span class="count">{groups[k].length}</span>}
          </button>
        ))}
      </div>

      {list == null ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <div class="empty">{tab === 'todo' ? '未回答の練習はありません' : tab === 'mine' ? '行く予定の練習はありません' : '今後の練習はまだありません'}</div>
      ) : (
        shown.map((v) => <PracticeCard key={v.practice.id} v={v} busy={busy} onAnswer={(a) => answer(v.practice.id, a)} />)
      )}
    </>
  );
}

function PracticeCard({ v, onAnswer, busy }: { v: PracticeView; onAnswer: (a: Answer) => void; busy: boolean }) {
  const p = v.practice;
  return (
    <article class="card practice" data-answer={v.myAnswer ?? 'none'} data-status={p.status}>
      <DateBlock date={p.date} />
      <div class="main">
        <button class="link" onClick={() => go(`/p/${encodeURIComponent(p.id)}`)}>
          <div class="time">
            {p.start}〜{p.end}
            <StatusBadge v={v} />
            {v.myAnswer == null && p.status !== '中止' && <span class="badge todo">未回答</span>}
          </div>
          <div class="place">{place(p)}</div>
          <div class="meta">
            <span>
              <strong>{v.goingCount}人</strong>
              {p.max ? ` / 上限${p.max}人` : ''}
            </span>
            <span>
              <strong>{feeLabel(v)}</strong>
            </span>
            <span>予約 {v.bookerName}</span>
          </div>
          {v.going.length > 0 && (
            <div class="chips">
              {v.going.map((a) => (
                <span class={`chip${a.kind === 'ゲスト' ? ' guest' : ''}`}>{a.name}</span>
              ))}
            </div>
          )}
          {p.memo && <div class="muted" style={{ marginTop: 6 }}>📝 {p.memo.split('\n')[0]}</div>}
        </button>
        <RsvpButtons v={v} onAnswer={onAnswer} busy={busy} />
      </div>
    </article>
  );
}
