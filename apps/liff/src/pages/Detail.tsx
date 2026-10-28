import { useEffect, useRef, useState } from 'preact/hooks';
import { endAfterStart, labelDate, roomInfo, yen, type Answer, type AttendeeView, type PracticePatch, type PracticeView } from '@studio-attendance/shared';
import { api } from '../api';
import { RoomSelect } from '../components/StudioRoom';
import { openExternal } from '../liff';
import { Avatar, FRESH_MS, Icon, Pass, RsvpButtons, Spinner, Syncing, TopBar, useApp, useRunner } from '../ui';

/**
 * 一覧にある内容ですぐ表示し、最新の内容は裏で取り直す（取り直している間もボタンは押せる）。
 * 一覧を取ったばかり（FRESH_MS 以内）なら取り直さず、一覧の変化（出欠の結果など）にそのまま合わせる
 */
export function usePractice(id: string) {
  const { toast, practices, practicesAt, updatePractice } = useApp();
  const inList = practices?.find((x) => x.practice.id === id) ?? null;
  const fresh = () => inList != null && practicesAt > 0 && Date.now() - practicesAt < FRESH_MS;
  // 取り直した・操作した結果。無い間は一覧の内容を出す
  const [own, setV] = useState<PracticeView | null>(null);
  const v = own ?? inList;
  const [loading, setLoading] = useState(() => !fresh());
  const [run, busy] = useRunner();

  useEffect(() => {
    setV(null);
    if (fresh()) return setLoading(false);
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
        { label: '時間', value: `${p.start}–${p.end}`, wide: true },
        { label: 'スタジオ', value: p.studio, jp: true, wide: !p.room },
        ...(p.room ? [{ label: '部屋', value: p.room, note: roomInfo(me.settings.studios, p.studio, p.room), jp: true }] : []),
        { label: '1人あたり', value: v.perPerson != null ? yen(v.perPerson) : '—', note: p.feeOverride ? '調整済み' : null },
        { label: 'スタジオ代', value: yen(p.fee) },
        { label: '参加人数', value: <>{v.goingCount}{p.max ? <small class="of">/{p.max}</small> : null}</>, note: p.min ? `最低人数 ${p.min}人` : null },
        { label: '予約者', value: v.bookerName, jp: true },
        ...(p.memo ? [{ label: 'メモ', value: p.memo, jp: true, wide: true }] : []),
      ]}
    />
  );
}

/** 「予定」から開く練習の画面。見るのと出欠・カレンダーだけ（編集・削除・募集は「募集」から） */
export function DetailPage({ id, focus }: { id: string; focus: 'calendar' | null }) {
  const { v, loading, busy, update } = usePractice(id);
  const calRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (v && focus === 'calendar') calRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [v != null, focus]);

  if (!v) return <><TopBar back />{loading ? <Spinner /> : <div class="empty">予約情報が見つかりません</div>}</>;
  const p = v.practice;

  return (
    <>
      <TopBar back>{loading && <Syncing />}</TopBar>

      <PracticePass v={v} />

      <RsvpButtons solo value={v.myAnswer} status={p.status} busy={busy} onAnswer={(a: Answer) => update(() => api('rsvp', { id, answer: a }))} />

      <Attendees v={v} onRemove={(a) => update(() => api('removeAttendance', { id, participant: a.participant }), '削除しました')} />

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

      {/* 古いお知らせのリンクなどから開いた予約者が、直す・消す場所に迷わないように */}
      {v.canEdit && (
        <p class="note" style={{ marginTop: 16 }}>
          編集・削除は{' '}
          <a href={`#/recruit/${encodeURIComponent(p.id)}`}>「募集」のこの予約情報</a>
          から
        </p>
      )}
    </>
  );
}

/** 参加メンバーの一覧。行く・保留・行かないの順に名前を出す。自分が足したゲスト（予約者と管理者はすべてのゲスト）は取り消せる */
function Attendees({ v, onRemove }: { v: PracticeView; onRemove: (a: AttendeeView) => void }) {
  const lists = [
    { label: '○ 行く', people: v.going },
    { label: '△ 未定', people: v.maybe },
    { label: '✕ 行かない', people: v.notGoing },
  ];
  return (
    <>
      <div class="sec-head">
        <Icon name="people" size={18} />
        参加者
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
                  {a.kind === 'ゲスト' && a.canRemove && (
                    <button class="x" aria-label={`${a.name}さんを削除`} onClick={() => confirm(`${a.name}さんを削除しますか？`) && onRemove(a)}>
                      <Icon name="x" size={14} />
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>
        ),
      )}
      {v.going.length + v.maybe.length + v.notGoing.length === 0 && <div class="muted">まだ誰も回答していません</div>}
    </>
  );
}

/** 練習を削除する前の確認の文。答えている人がいれば人数も添える */
export function deleteMessage(v: PracticeView): string {
  const p = v.practice;
  const answered = v.goingCount + v.maybe.length;
  return [
    `${labelDate(p.date)} ${p.start}〜 ${p.studio}${p.room ? ' ' + p.room : ''} を削除しますか？`,
    answered > 0 ? `回答している人がいます（行く${v.goingCount}人・未定${v.maybe.length}人）。回答も削除されます。` : '回答も削除されます。',
    'グループへの連絡は送られないので、必要ならグループで伝えてください。',
  ].join('\n');
}

/** 練習の編集（予約者と管理者）。「募集」の練習の画面に出す */
export function EditForm({
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
            <span>上限人数</span>
            <input type="number" inputMode="numeric" placeholder="なし" value={f.max} onInput={set('max')} />
          </label>
          <label class="field">
            <span>最低人数</span>
            <input type="number" inputMode="numeric" placeholder={`標準 ${me.settings.minDefault}人`} value={f.min} onInput={set('min')} />
          </label>
          <label class="field">
            <span>1人あたり ¥</span>
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
            if (confirm(deleteMessage(v))) onDelete();
          }}
        >
          削除する
        </button>
      </section>
    </details>
  );
}
