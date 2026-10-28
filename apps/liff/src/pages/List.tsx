import { useEffect, useState } from 'preact/hooks';
import { labelDate, type Answer, type PracticeView } from '@studio-attendance/shared';
import { api } from '../api';
import { sending, wanted } from '../answering';
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

  const { answer } = useAnswer();

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
        {(practicesAt === 0 || busy) && <Syncing />}
      </header>

      {list == null ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <div class="empty">
          <div>{tab === 'todo' ? '未定の予約情報はありません。' : tab === 'mine' ? '行く予約情報はありません。' : '登録されている予約情報はありません。'}</div>
          {tab === 'all' && <p class="note">所属グループの予約情報が出ないときは、そのグループの募集メッセージの「RSVP」から一度開いてください</p>}
          {tab === 'all' && <p class="note">スタジオの予約は「募集」の右上の＋から登録できます</p>}
        </div>
      ) : (
        shown.map((v) => <PracticeCard key={v.practice.id} v={v} onAnswer={(a) => answer(v.practice.id, a)} />)
      )}
    </>
  );
}

/**
 * 押した瞬間の見た目。記号・行く人数・満員かどうかを先に変える
 * （名前の並びと1人あたりはサーバーの結果で差し替える）
 */
function optimistic(v: PracticeView, a: Answer): PracticeView {
  const was = v.myAnswer === '行く';
  const now = a === '行く';
  const goingCount = Math.max(0, v.goingCount + (now === was ? 0 : now ? 1 : -1));
  const p = v.practice;
  const status = p.status === '満員' || p.status === '募集中' ? (p.max != null && p.max > 0 && goingCount >= p.max ? '満員' : '募集中') : p.status;
  return { ...v, myAnswer: a, goingCount, practice: status === p.status ? p : { ...p, status } };
}

/**
 * 回答する。押した瞬間に記号を変え、待たずに続けて押し直せる（ボタンは止めない）。
 * サーバーには練習ごとに1つずつ送り、送っている間に押し直したら、終わったあと最後の回答だけを送る。
 * 途中の結果では画面を戻さず、最後の結果で人数なども含めて差し替える（失敗したら取り直すか、最後に記録できた内容に戻す）
 */
export function useAnswer() {
  const { practices: list, updatePractice, toast } = useApp();
  const answer = (id: string, a: Answer) => {
    const current = (list ?? []).find((x) => x.practice.id === id);
    if (current) updatePractice(optimistic(current, a));
    wanted.set(id, a);
    if (sending.has(id)) return;
    const loop = (async () => {
      // 最後にサーバーに記録できた内容。失敗して取り直せなかったときはここに戻す
      let confirmed = current;
      try {
        for (;;) {
          const target = wanted.get(id)!;
          try {
            const r = await api('rsvp', { id, answer: target });
            confirmed = r;
            if (wanted.get(id) === target) {
              wanted.delete(id);
              updatePractice(r);
              return;
            }
          } catch (e) {
            // 送っている間に押し直していれば、その回答を送り直す
            if (wanted.get(id) !== target) continue;
            wanted.delete(id);
            toast(e instanceof Error ? e.message : String(e), true);
            // 押した時点の控えは古いかもしれないので、取り直して差し替える（取り直している間に押し直したら、それを送る）
            try {
              const fresh = await api('getPractice', { id });
              if (wanted.has(id)) continue;
              updatePractice(fresh);
            } catch {
              if (wanted.has(id)) continue;
              if (confirmed) updatePractice(confirmed, { revert: true });
            }
            return;
          }
        }
      } finally {
        sending.delete(id);
      }
    })();
    sending.set(id, loop);
  };
  return { answer };
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
