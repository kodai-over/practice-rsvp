import { useEffect, useRef, useState } from 'preact/hooks';
import { labelDate, yen, type Answer, type AttendeeView, type PracticePatch, type PracticeView } from '@pb/shared';
import { api } from '../api';
import { RoomInfo, RoomSelect } from '../components/StudioRoom';
import { openExternal } from '../liff';
import { RsvpButtons, Spinner, StatusBadge, TopBar, go, place, useApp, useRunner } from '../ui';

export function DetailPage({ id, focus }: { id: string; focus: 'calendar' | 'recruit' | null }) {
  const { me, updatePractice, setPractices } = useApp();
  const [v, setV] = useState<PracticeView | null>(null);
  const [run, busy] = useRunner();
  const calRef = useRef<HTMLDivElement>(null);
  const recruitRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    run(() => api('getPractice', { id })).then((r) => r && setV(r));
  }, [id]);

  useEffect(() => {
    const target = focus === 'calendar' ? calRef : focus === 'recruit' ? recruitRef : null;
    if (v && target) target.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [v != null, focus]);

  if (!v) return <><TopBar title="練習" back />{busy ? <Spinner /> : <div class="empty">練習が見つかりません</div>}</>;

  const p = v.practice;
  const update = async (fn: () => Promise<PracticeView>, done?: string) => {
    const r = await run(fn, done);
    if (r) {
      setV(r);
      updatePractice(r); // 一覧にもすぐ反映する
    }
    return r;
  };

  return (
    <>
      <TopBar title={labelDate(p.date)} back />

      <section class="card">
        <div class="time" style={{ fontSize: 22, fontWeight: 800 }}>
          {p.start}〜{p.end}
          <StatusBadge v={v} />
        </div>
        <div class="place">{place(p)}</div>
        <RoomInfo studios={me.settings.studios} studio={p.studio} room={p.room} />
        <div class="meta">
          <span>予約 {v.bookerName}</span>
          {v.groupNames.length > 0 && <span>募集先 {v.groupNames.join('、')}</span>}
        </div>
        <RsvpButtons v={v} busy={busy} onAnswer={(a: Answer) => update(() => api('rsvp', { id, answer: a }))} />
      </section>

      <section class="card">
        <div class="row">
          <div class="grow">
            <div class="muted">1人あたり{p.feeOverride ? '（予約者が調整）' : ''}</div>
            <div class="big-fee">{v.perPerson != null ? yen(v.perPerson) : '—'}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div class="muted">スタジオ代</div>
            <div>{yen(p.fee)}</div>
            <div class="muted">
              {v.goingCount}人{p.max ? ` / 上限${p.max}人` : ''}
              {p.min ? `・最低${p.min}人` : ''}
            </div>
          </div>
        </div>
      </section>

      <Attendees title={`行く（${v.goingCount}人）`} list={v.going} onRemove={(a) => update(() => api('removeAttendance', { id, participant: a.participant }), '取り消しました')} />
      {v.maybe.length > 0 && <Attendees title={`保留（${v.maybe.length}人）`} list={v.maybe} onRemove={(a) => update(() => api('removeAttendance', { id, participant: a.participant }), '取り消しました')} />}
      {v.notGoing.length > 0 && <Attendees title={`行かない（${v.notGoing.length}人）`} list={v.notGoing} onRemove={(a) => update(() => api('removeAttendance', { id, participant: a.participant }), '取り消しました')} />}

      {p.status !== '中止' && <GuestForm onAdd={(name) => update(() => api('addGuest', { id, name }), `${name}さんを追加しました`)} busy={busy} />}

      <Memo v={v} busy={busy} onAppend={(text) => update(() => api('appendMemo', { id, text }), 'メモを追加しました')} />

      <div class="section-title" ref={calRef}>
        カレンダーに追加
      </div>
      <div class="grid2">
        <button class="btn" onClick={() => openExternal(v.googleCalendarUrl)}>
          Googleカレンダー
        </button>
        <button class="btn" onClick={() => openExternal(v.icsUrl)}>
          iPhoneのカレンダー
        </button>
      </div>

      <div ref={recruitRef} />
      {v.canEdit && (p.status === '募集中' || p.status === '満員') && (
        <RecruitForm v={v} busy={busy} onSend={(groups) => update(() => api('recruitPractice', { id, groups }), 'グループに募集を送りました')} />
      )}

      {v.joinUrl && <JoinLink url={v.joinUrl} />}

      {v.canEdit && (
        <EditForm
          v={v}
          busy={busy}
          onSave={(patch) => update(() => api('updatePractice', { id, patch }), '保存しました')} onCancel={() => update(() => api('cancelPractice', { id }), '中止にしました')}
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

function Attendees({ title, list, onRemove }: { title: string; list: AttendeeView[]; onRemove: (a: AttendeeView) => void }) {
  return (
    <>
      <div class="section-title">{title}</div>
      <section class="card">
        {list.length === 0 ? (
          <div class="muted">まだいません</div>
        ) : (
          <ul class="list">
            {list.map((a) => (
              <li>
                <span class="grow">
                  {a.name}
                  {a.kind === 'ゲスト' && (
                    <span class="muted">
                      {' '}
                      ゲスト{a.addedByName ? `（${a.addedByName}さんが追加）` : a.via === '参加リンク' ? '（参加リンク）' : ''}
                    </span>
                  )}
                </span>
                {a.canRemove && (
                  <button class="btn small" onClick={() => confirm(`${a.name}さんの出欠を取り消しますか？`) && onRemove(a)}>
                    取消
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function GuestForm({ onAdd, busy }: { onAdd: (name: string) => Promise<unknown>; busy: boolean }) {
  const [name, setName] = useState('');
  return (
    <>
      <div class="section-title">ゲストを追加</div>
      <form
        class="row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (name.trim() && (await onAdd(name.trim()))) setName('');
        }}
      >
        <input type="text" class="grow" placeholder="グループにいない人の名前" value={name} onInput={(e) => setName(e.currentTarget.value)} maxLength={30} />
        <button class="btn primary" disabled={busy || !name.trim()}>
          追加
        </button>
      </form>
    </>
  );
}

function Memo({ v, onAppend, busy }: { v: PracticeView; onAppend: (t: string) => Promise<unknown>; busy: boolean }) {
  const [text, setText] = useState('');
  return (
    <>
      <div class="section-title">練習メモ</div>
      <section class="card">
        {v.practice.memo ? <div class="memo">{v.practice.memo}</div> : <div class="muted">練習の目的や内容を書けます</div>}
        <form
          class="row"
          style={{ marginTop: 10 }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (text.trim() && (await onAppend(text.trim()))) setText('');
          }}
        >
          <input type="text" class="grow" placeholder="例：ショーケースの通し" value={text} onInput={(e) => setText(e.currentTarget.value)} maxLength={300} />
          <button class="btn" disabled={busy || !text.trim()}>
            追記
          </button>
        </form>
      </section>
    </>
  );
}

function RecruitForm({ v, onSend, busy }: { v: PracticeView; onSend: (groups: string[]) => Promise<unknown>; busy: boolean }) {
  const { me } = useApp();
  const [picked, setPicked] = useState<string[]>([]);
  const rest = me.groups.filter((g) => !v.practice.groups.includes(g.id));
  return (
    <>
      <div class="section-title">グループに募集</div>
      <section class="card">
        {v.groupNames.length > 0 && <div class="muted" style={{ marginBottom: 6 }}>募集済み: {v.groupNames.join('、')}</div>}
        {me.groups.length === 0 ? (
          <div class="muted">Botをグループに招待すると、ここから募集を送れます</div>
        ) : rest.length === 0 ? (
          <div class="muted">すべてのグループに募集済みです</div>
        ) : (
          <>
            {rest.map((g) => (
              <label class="check">
                <input
                  type="checkbox"
                  checked={picked.includes(g.id)}
                  onChange={(e) => setPicked(e.currentTarget.checked ? [...picked, g.id] : picked.filter((x) => x !== g.id))}
                />
                {g.name}
              </label>
            ))}
            <button
              class="btn primary block"
              style={{ marginTop: 8 }}
              disabled={busy || picked.length === 0}
              onClick={async () => {
                if (await onSend(picked)) setPicked([]);
              }}
            >
              募集を送る
            </button>
          </>
        )}
      </section>
    </>
  );
}

function JoinLink({ url }: { url: string }) {
  const { toast } = useApp();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('参加リンクをコピーしました');
    } catch {
      prompt('参加リンク', url);
    }
  };
  return (
    <>
      <div class="section-title">参加リンク（LINEグループにいない人向け）</div>
      <section class="card">
        <div class="muted" style={{ marginBottom: 8 }}>
          このリンクを本人に送ると、ブラウザで名前を入れて出欠を出せます。練習が終わると使えなくなります。
        </div>
        <button class="btn block" onClick={copy}>
          リンクをコピー
        </button>
      </section>
    </>
  );
}

function EditForm({
  v,
  onSave,
  onCancel,
  onDelete,
  busy,
}: {
  v: PracticeView;
  onSave: (p: PracticePatch) => Promise<unknown>;
  onCancel: () => Promise<unknown>;
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
    <>
      <div class="section-title">予約者の操作</div>
      <section class="card">
        <div class="grid2">
          <label class="field">
            <span>開始</span>
            <input type="time" value={f.start} onInput={set('start')} />
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
            <span>スタジオ代（円）</span>
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
            <input type="number" inputMode="numeric" placeholder="標準" value={f.min} onInput={set('min')} />
          </label>
          <label class="field">
            <span>1人の金額</span>
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
        {p.status !== '中止' && (
          <button
            class="btn danger block"
            style={{ marginTop: 8 }}
            disabled={busy}
            onClick={async () => {
              if (confirm(v.groupNames.length ? `この練習を中止にして、募集したグループ（${v.groupNames.join('、')}）に知らせますか？` : 'この練習を中止にしますか？')) {
                if (await onCancel()) go('/');
              }
            }}
          >
            中止にする
          </button>
        )}
        <button
          class="btn danger block"
          style={{ marginTop: 8 }}
          disabled={busy}
          onClick={() => {
            const notice =
              v.groupNames.length > 0 && p.status !== '中止'
                ? `\n募集を流したグループ（${v.groupNames.join('、')}）に中止の連絡が届きます。`
                : '';
            if (confirm(`この練習を削除しますか？出欠も消えます。${notice}`)) onDelete();
          }}
        >
          削除する
        </button>
      </section>
    </>
  );
}
