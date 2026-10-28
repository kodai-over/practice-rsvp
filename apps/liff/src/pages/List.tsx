import { useEffect, useState } from 'preact/hooks';
import { labelDate, type Answer, type PracticeView } from '@studio-attendance/shared';
import { api } from '../api';
import { AvatarStack, FRESH_MS, Fee, Icon, RsvpButtons, Spinner, StatusBadge, Stub, Syncing, Tabs, go, place, useApp, useRunner } from '../ui';

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
  const { me, practices: list, practicesAt, setPractices } = useApp();
  const [tab, setTab] = useState<Tab>(() => (initialTab === 'mine' || initialTab === 'todo' || initialTab === 'all' ? initialTab : readTab()));
  const [run, busy] = useRunner();

  useEffect(() => {
    // 起動時のまとめ取得から時間がたっていれば取り直す（前回の表示のときは起動処理が取り直すので待つ）
    if (practicesAt > 0 && Date.now() - practicesAt > FRESH_MS) run(() => api('listPractices')).then((r) => r && setPractices(r));
  }, []);

  const selectTab = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* 保存できなくても動く */
    }
  };

  const { answer, pending } = useAnswer();

  // 「予定」に出すのは、自分に招待が来た（入っているグループに募集された）練習と、自分が招待を送った（登録した）練習。
  // 答えた・ゲストを足した練習も出す。管理者でも、ほかの練習は「募集」で見る
  const mine = (list ?? []).filter(
    (v) => v.practice.booker === me.member.userId || v.practice.groups.some((g) => me.member.groups.includes(g)) || v.myAnswer != null || v.involved,
  );
  const active = mine.filter((v) => v.practice.status !== '中止');
  const groups: Record<Tab, PracticeView[]> = {
    all: mine,
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
        {(practicesAt === 0 || busy || pending.size > 0) && <Syncing />}
      </header>

      {list == null ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <div class="empty">
          <div>{tab === 'todo' ? '未定の練習はありません' : tab === 'mine' ? '行く練習はありません' : '登録されている予約情報はありません。'}</div>
          {tab === 'all' && <p class="note">入っているグループの練習が出ないときは、そのグループの募集メッセージの「RSVP」から一度開いてください</p>}
          {tab === 'all' && <p class="note">スタジオの予約は「募集」の右上の＋から登録できます</p>}
        </div>
      ) : (
        shown.map((v) => <PracticeCard key={v.practice.id} v={v} busy={pending.has(v.practice.id)} onAnswer={(a) => answer(v.practice.id, a)} />)
      )}
    </>
  );
}

/**
 * 出欠を答える。押した瞬間に色を変え、サーバーの結果が来たら人数なども含めて差し替える（失敗したら元に戻す）。
 * 待つのは答えている練習だけ。ほかの練習の記号は続けて押せる
 */
export function useAnswer() {
  const { practices: list, updatePractice, toast } = useApp();
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const answer = async (id: string, a: Answer) => {
    const before = (list ?? []).find((x) => x.practice.id === id);
    if (before) updatePractice({ ...before, myAnswer: a });
    setPending((s) => new Set(s).add(id));
    try {
      updatePractice(await api('rsvp', { id, answer: a }));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
      // 押した時点の控えは古いかもしれないので、取り直して差し替える（取れなければ控えに戻す）
      try {
        updatePractice(await api('getPractice', { id }));
      } catch {
        if (before) updatePractice(before, { revert: true });
      }
    } finally {
      setPending((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  };
  return { answer, pending };
}

export function PracticeCard({ v, onAnswer, busy }: { v: PracticeView; onAnswer: (a: Answer) => void; busy?: boolean }) {
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
      <RsvpButtons value={v.myAnswer} status={p.status} busy={busy} onAnswer={onAnswer} />
    </article>
  );
}
