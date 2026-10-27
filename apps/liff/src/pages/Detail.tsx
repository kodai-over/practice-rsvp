import { useEffect, useRef, useState } from 'preact/hooks';
import { endAfterStart, roomInfo, yen, type Answer, type PracticePatch, type PracticeView } from '@studio-attendance/shared';
import { api } from '../api';
import { RoomSelect } from '../components/StudioRoom';
import { openExternal } from '../liff';
import { Avatar, Icon, Pass, RsvpButtons, Spinner, Syncing, TopBar, go, useApp, useRunner } from '../ui';

/** 一覧にある内容ですぐ表示し、最新の内容は裏で取り直す（取り直している間もボタンは押せる） */
export function usePractice(id: string) {
  const { toast, practices, updatePractice } = useApp();
  const fromList = () => practices?.find((x) => x.practice.id === id) ?? null;
  const [v, setV] = useState<PracticeView | null>(fromList);
  const [loading, setLoading] = useState(true);
  const [run, busy] = useRunner();

  useEffect(() => {
    setV(fromList());
    setLoading(true);
    api('getPractice', { id })
      .then((r) => {
        setV(r);
        updatePractice(r);
      })
      .catch((e) => toast(e instanceof Error ? e.message : String(e), true))
      .finally(() => setLoading(false));
  }, [id]);

  const update = async (fn: () => Promise<PracticeView>, done?: string) => {
    const r = await run(fn, done);
    if (r) {
      setV(r);
      updatePractice(r); // 一覧にもすぐ反映する
    }
    return r;
  };
  return { v, loading, run, busy, update };
}

/** 練習のパス。日時・場所・金額・人数 */
export function PracticePass({ v }: { v: PracticeView }) {
  const { me } = useApp();
  const p = v.practice;
  return (
    <Pass
      date={p.date}
      status={p.status}
      fields={[
        { label: 'TIME', value: `${p.start}–${p.end}`, wide: true },
        { label: 'STUDIO', value: p.studio, jp: true, wide: !p.room },
        ...(p.room ? [{ label: 'ROOM', value: p.room, note: roomInfo(me.settings.studios, p.studio, p.room), jp: true }] : []),
        { label: 'PER PERSON', value: v.perPerson != null ? yen(v.perPerson) : '—', note: p.feeOverride ? '調整済み' : null },
        { label: 'TOTAL', value: yen(p.fee) },
        { label: 'GOING', value: <>{v.goingCount}{p.max ? <small class="of">/{p.max}</small> : null}</>, note: p.min ? `最低 ${p.min}人` : null },
        { label: 'HOST', value: v.bookerName, jp: true },
        ...(p.memo ? [{ label: 'MEMO', value: p.memo, jp: true, wide: true }] : []),
      ]}
    />
  );
}

/** 練習の画面。出欠・カレンダー・（予約者と管理者は）編集だけ */
export function DetailPage({ id, focus }: { id: string; focus: 'calendar' | null }) {
  const { setPractices } = useApp();
  const { v, loading, run, busy, update } = usePractice(id);
  const calRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (v && focus === 'calendar') calRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [v != null, focus]);

  if (!v) return <><TopBar back />{loading ? <Spinner /> : <div class="empty">練習が見つかりません</div>}</>;
  const p = v.practice;

  return (
    <>
      <TopBar back>{loading && <Syncing />}</TopBar>

      <PracticePass v={v} />

      <RsvpButtons solo value={v.myAnswer} status={p.status} busy={busy} onAnswer={(a: Answer) => update(() => api('rsvp', { id, answer: a }))} />

      <Attendees v={v} />

      <div class="sec-head" ref={calRef}>
        <Icon name="calendar" size={18} />
        カレンダー
      </div>
      <div class="grid2">
        <button class="btn ghost" onClick={() => openExternal(v.googleCalendarUrl)}>
          Google
        </button>
        <button class="btn ghost" onClick={() => openExternal(v.icsUrl)}>
          iPhone
        </button>
      </div>

      {v.canEdit && (
        <EditForm
          v={v}
          busy={busy}
          onSave={(patch) => update(() => api('updatePractice', { id, patch }), '保存しました')}
          onDelete={async () => {
            const list = await run(() => api('deletePractice', { id }), '削除しました');
            if (list) {
              setPractices(list, true);
              go('/');
            }
          }}
        />
      )}
    </>
  );
}

/** 参加メンバーの一覧。行く・保留・行かないの順に名前を出す */
function Attendees({ v }: { v: PracticeView }) {
  const lists = [
    { label: '○ 行く', people: v.going },
    { label: '△ 保留', people: v.maybe },
    { label: '✕ 行かない', people: v.notGoing },
  ];
  return (
    <>
      <div class="sec-head">
        <Icon name="people" size={18} />
        参加メンバー
        <span class="n">{v.going.length + v.maybe.length + v.notGoing.length}</span>
      </div>
      {lists.map(({ label, people }) =>
        people.length === 0 ? null : (
          <div key={label} style={{ marginBottom: 10 }}>
            <div class="muted" style={{ marginBottom: 4 }}>
              {label}（{people.length}）
            </div>
            <div class="people">
              {people.map((a) => (
                <span class="person" key={a.participant}>
                  <Avatar name={a.name} guest={a.kind === 'ゲスト'} />
                  <span>{a.name}</span>
                </span>
              ))}
            </div>
          </div>
        ),
      )}
      {v.going.length + v.maybe.length + v.notGoing.length === 0 && <div class="muted">まだ誰も答えていません</div>}
    </>
  );
}

function EditForm({
  v,
  onSave,
  onDelete,
  busy,
}: {
  v: PracticeView;
  onSave: (p: PracticePatch) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
  busy: boolean;
}) {
  const { me } = useApp();
  const p = v.practice;
  const [f, setF] = useState({
    start: p.start,
    end: p.end,
    room: p.room,
    fee: String(p.fee),
    max: p.max ? String(p.max) : '',
    min: p.min ? String(p.min) : '',
    feeOverride: p.feeOverride ? String(p.feeOverride) : '',
    memo: p.memo,
  });
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.currentTarget as HTMLInputElement).value });
  const num = (s: string) => (s.trim() === '' ? null : Number(s));

  return (
    <details class="menu edit">
      <summary class="menu-row">
        <Icon name="edit" size={20} />
        <span class="grow">編集</span>
        <Icon name="chevron" size={18} />
      </summary>
      <section class="card" style={{ margin: 0, borderRadius: 0 }}>
        <div class="grid2">
          <label class="field">
            <span>開始</span>
            <input type="time" value={f.start} onInput={(e) => setF({ ...f, start: e.currentTarget.value, end: endAfterStart(e.currentTarget.value, f.end) })} />
          </label>
          <label class="field">
            <span>終了</span>
            <input type="time" value={f.end} onInput={set('end')} />
          </label>
        </div>
        <div class="grid2">
          <div class="field">
            <span>部屋</span>
            <RoomSelect studios={me.settings.studios} studio={p.studio} value={f.room} onChange={(room) => setF({ ...f, room })} />
          </div>
          <label class="field">
            <span>スタジオ代 ¥</span>
            <input type="number" inputMode="numeric" value={f.fee} onInput={set('fee')} />
          </label>
        </div>
        <div class="grid3">
          <label class="field">
            <span>上限</span>
            <input type="number" inputMode="numeric" placeholder="なし" value={f.max} onInput={set('max')} />
          </label>
          <label class="field">
            <span>最低</span>
            <input type="number" inputMode="numeric" placeholder="標準" value={f.min} onInput={set('min')} />
          </label>
          <label class="field">
            <span>1人 ¥</span>
            <input type="number" inputMode="numeric" placeholder="自動" value={f.feeOverride} onInput={set('feeOverride')} />
          </label>
        </div>
        <label class="field">
          <span>メモ</span>
          <textarea rows={3} value={f.memo} onInput={set('memo')} />
        </label>
        <button
          class="btn primary block"
          disabled={busy}
          onClick={() =>
            onSave({ start: f.start, end: f.end, room: f.room, fee: Number(f.fee) || 0, max: num(f.max), min: num(f.min), feeOverride: num(f.feeOverride), memo: f.memo })
          }
        >
          保存
        </button>
        <button
          class="btn danger block"
          style={{ marginTop: 8 }}
          disabled={busy}
          onClick={() => {
            if (confirm('この練習を削除しますか？出欠も消えます。グループへの連絡は送られないので、必要ならグループで伝えてください。')) onDelete();
          }}
        >
          削除する
        </button>
      </section>
    </details>
  );
}
