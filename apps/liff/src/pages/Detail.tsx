import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { roomInfo, yen, type Answer, type AttendeeView, type PracticePatch, type PracticeView } from '@pb/shared';
import { api } from '../api';
import { RoomSelect } from '../components/StudioRoom';
import { openExternal } from '../liff';
import { Avatar, Icon, Pass, RsvpButtons, Spinner, Syncing, TopBar, go, useApp, useRunner } from '../ui';

export function DetailPage({ id, focus }: { id: string; focus: 'calendar' | 'recruit' | null }) {
  const { me, toast, practices, updatePractice, setPractices } = useApp();
  const fromList = () => practices?.find((x) => x.practice.id === id) ?? null;
  const [v, setV] = useState<PracticeView | null>(fromList);
  const [loading, setLoading] = useState(true);
  const [run, busy] = useRunner();
  const calRef = useRef<HTMLDivElement>(null);
  const recruitRef = useRef<HTMLDivElement>(null);

  // 一覧にある内容ですぐ表示し、最新の内容は裏で取り直す（取り直している間もボタンは押せる）
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

  useEffect(() => {
    const target = focus === 'calendar' ? calRef : focus === 'recruit' ? recruitRef : null;
    if (v && target) target.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [v != null, focus]);

  if (!v) return <><TopBar back />{loading ? <Spinner /> : <div class="empty"><div class="empty-mark">—</div>練習が見つかりません</div>}</>;

  const p = v.practice;
  const update = async (fn: () => Promise<PracticeView>, done?: string) => {
    const r = await run(fn, done);
    if (r) {
      setV(r);
      updatePractice(r); // 一覧にもすぐ反映する
    }
    return r;
  };

  const remove = (a: AttendeeView) => update(() => api('removeAttendance', { id, participant: a.participant }), '取り消しました');
  const info = roomInfo(me.settings.studios, p.studio, p.room);

  return (
    <>
      <TopBar back>
        {loading && <Syncing />}
      </TopBar>

      <Pass
        id={p.id}
        date={p.date}
        status={p.status}
        fields={[
          { label: 'TIME', value: `${p.start}–${p.end}`, wide: true },
          { label: 'STUDIO', value: p.studio, jp: true, wide: !p.room },
          ...(p.room ? [{ label: 'ROOM', value: p.room, note: info, jp: true }] : []),
          { label: 'PER PERSON', value: v.perPerson != null ? yen(v.perPerson) : '—', note: p.feeOverride ? '調整済み' : null },
          { label: 'TOTAL', value: yen(p.fee) },
          { label: 'GOING', value: <>{v.goingCount}{p.max ? <small class="of">/{p.max}</small> : null}</>, note: p.min ? `最低 ${p.min}人` : null },
          { label: 'HOST', value: v.bookerName, jp: true },
        ]}
      />

      <RsvpButtons solo value={v.myAnswer} status={p.status} busy={busy} onAnswer={(a: Answer) => update(() => api('rsvp', { id, answer: a }))} />

      <People mark="○" label="行く" list={v.going} onRemove={remove}>
        {p.status !== '中止' && <GuestForm onAdd={(name) => update(() => api('addGuest', { id, name }), `${name}さんを追加しました`)} busy={busy} />}
      </People>
      {v.maybe.length > 0 && <People mark="△" label="保留" list={v.maybe} onRemove={remove} dim />}
      {v.notGoing.length > 0 && <People mark="✕" label="行かない" list={v.notGoing} onRemove={remove} dim />}

      <Memo v={v} busy={busy} onAppend={(text) => update(() => api('appendMemo', { id, text }), 'メモを追加しました')} />

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

      <div ref={recruitRef} />
      {v.canEdit && (p.status === '募集中' || p.status === '満員') && (
        <RecruitForm v={v} busy={busy} onSend={(groups) => update(() => api('recruitPractice', { id, groups }), 'グループに募集を送りました')} />
      )}

      {v.joinUrl && <JoinLink url={v.joinUrl} />}

      {v.canEdit && (
        <EditForm
          v={v}
          busy={busy}
          onSave={(patch) => update(() => api('updatePractice', { id, patch }), '保存しました')}
          onCancel={() => update(() => api('cancelPractice', { id }), '中止にしました')}
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

function People({ mark, label, list, onRemove, dim, children }: { mark: string; label: string; list: AttendeeView[]; onRemove: (a: AttendeeView) => void; dim?: boolean; children?: ComponentChildren }) {
  return (
    <section class={dim ? 'dim' : undefined}>
      <div class="sec-head">
        <span aria-hidden="true">{mark}</span>
        {label}
        <span class="n">{list.length}</span>
      </div>
      <div class="people">
        {list.map((a) => (
          <span
            class="person"
            title={a.kind === 'ゲスト' ? `ゲスト${a.addedByName ? `（${a.addedByName}さんが追加）` : a.via === '参加リンク' ? '（参加リンク）' : ''}` : undefined}
          >
            <Avatar name={a.name} guest={a.kind === 'ゲスト'} />
            <span>{a.name}</span>
            {a.canRemove && (
              <button class="x" aria-label={`${a.name}さんの出欠を取り消す`} onClick={() => confirm(`${a.name}さんの出欠を取り消しますか？`) && onRemove(a)}>
                <Icon name="x" size={14} />
              </button>
            )}
          </span>
        ))}
        {list.length === 0 && <span class="muted">—</span>}
      </div>
      {children}
    </section>
  );
}

function GuestForm({ onAdd, busy }: { onAdd: (name: string) => Promise<unknown>; busy: boolean }) {
  const [name, setName] = useState('');
  return (
    <form
      class="inline-form"
      style={{ marginTop: 10 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (name.trim() && (await onAdd(name.trim()))) setName('');
      }}
    >
      <input type="text" placeholder="ゲストを追加" aria-label="ゲストの名前" value={name} onInput={(e) => setName(e.currentTarget.value)} maxLength={30} />
      <button class="round-btn" aria-label="ゲストを追加" disabled={busy || !name.trim()}>
        <Icon name="plus" />
      </button>
    </form>
  );
}

function Memo({ v, onAppend, busy }: { v: PracticeView; onAppend: (t: string) => Promise<unknown>; busy: boolean }) {
  const [text, setText] = useState('');
  return (
    <section>
      <div class="sec-head">
        <Icon name="note" size={18} />
        メモ
      </div>
      {v.practice.memo && (
        <div class="card memo" style={{ marginBottom: 10 }}>
          {v.practice.memo}
        </div>
      )}
      <form
        class="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (text.trim() && (await onAppend(text.trim()))) setText('');
        }}
      >
        <input type="text" placeholder={v.practice.memo ? '追記する' : '例：ショーケースの通し'} aria-label="メモを追記" value={text} onInput={(e) => setText(e.currentTarget.value)} maxLength={300} />
        <button class="round-btn" aria-label="メモを追記" disabled={busy || !text.trim()}>
          <Icon name="plus" />
        </button>
      </form>
    </section>
  );
}

function RecruitForm({ v, onSend, busy }: { v: PracticeView; onSend: (groups: string[]) => Promise<unknown>; busy: boolean }) {
  const { me } = useApp();
  const [picked, setPicked] = useState<string[]>([]);
  if (me.groups.length === 0) return null;
  const sent = (gid: string) => v.practice.groups.includes(gid);
  return (
    <section>
      <div class="sec-head">
        <Icon name="send" size={18} />
        募集
      </div>
      <div class="toggles">
        {me.groups.map((g) =>
          sent(g.id) ? (
            <button class="toggle" disabled aria-label={`${g.name}（募集済み）`}>
              <Icon name="check" size={16} />
              {g.name}
            </button>
          ) : (
            <button
              class="toggle"
              aria-pressed={picked.includes(g.id)}
              onClick={() => setPicked(picked.includes(g.id) ? picked.filter((x) => x !== g.id) : [...picked, g.id])}
            >
              {g.name}
            </button>
          ),
        )}
      </div>
      {me.groups.some((g) => !sent(g.id)) && (
        <button
          class="btn primary block"
          style={{ marginTop: 12 }}
          disabled={busy || picked.length === 0}
          onClick={async () => {
            if (await onSend(picked)) setPicked([]);
          }}
        >
          <Icon name="send" size={18} />
          {picked.length > 0 ? `${picked.length}グループに募集を送る` : '募集を送る'}
        </button>
      )}
    </section>
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
    <section>
      <div class="sec-head">
        <Icon name="link" size={18} />
        参加リンク
        <span class="muted">LINEなしで出欠</span>
      </div>
      <div class="copy-row">
        <code>{url.replace(/^https?:\/\//, '')}</code>
        <button class="icon-btn" aria-label="参加リンクをコピー" onClick={copy}>
          <Icon name="copy" size={20} />
        </button>
      </div>
    </section>
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
    </details>
  );
}
