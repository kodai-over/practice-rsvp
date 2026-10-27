import { useEffect, useState } from 'preact/hooks';
import { addDays, defaultFee, endAfterStart, labelDate, skippedNote, toJstDate, type DraftItemKind, type NewPracticeInput, type Reservation } from '@studio-attendance/shared';
import { api } from '../api';
import { RoomInfo, RoomSelect, StudioSelect } from '../components/StudioRoom';
import { BusyOverlay, Icon, Spinner, TopBar, go, useApp, useRunner } from '../ui';

interface FormRow {
  key: number;
  date: string;
  start: string;
  end: string;
  studio: string;
  room: string;
  fee: string;
  max: string;
  min: string;
  memo: string;
  kind?: DraftItemKind | 'incomplete';
  /** スタジオ代を標準料金から自動で入れた（手で直したら false） */
  feeAuto?: boolean;
  /** この予約の募集先（空なら登録だけ） */
  groups: string[];
  /** 続けて取った予約を1つにまとめたときの、まとめる前の予約（「分ける」で分け直せる） */
  parts?: Reservation[];
}

let seq = 0;
const emptyRow = (over: Partial<Omit<FormRow, 'key'>> = {}): FormRow => ({
  date: '',
  start: '19:00',
  end: '21:00',
  studio: '',
  room: '',
  fee: '',
  max: '',
  min: '',
  memo: '',
  groups: [],
  ...over,
  key: ++seq,
});
const fromReservation = (r: Partial<Reservation>, kind: FormRow['kind'], groups: string[] = [], parts?: Reservation[]): FormRow =>
  emptyRow({ date: r.date ?? '', start: r.start ?? '', end: r.end ?? '', studio: r.studio ?? '', room: r.room ?? '', fee: r.fee != null ? String(r.fee) : '', kind, groups, parts });

/** 読み取り結果の印。延長は既存の練習を更新し、登録済みは飛ばす */
const KIND_TAG: Record<string, { label: string; cls: string }> = {
  extension: { label: '延長', cls: '' },
  duplicate: { label: '登録済み', cls: 'soft' },
  incomplete: { label: '要入力', cls: 'alert' },
};

/** 画像を描画できる形で読み込む。createImageBitmap が使えない・失敗する端末では <img> で読む */
async function loadImage(file: File): Promise<{ img: CanvasImageSource; width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return { img: bmp, width: bmp.width, height: bmp.height };
    } catch {
      /* 下の方法で読み直す */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** スクショを縮小して base64 に（送るデータを小さくする） */
async function shrink(file: File): Promise<{ mimeType: string; data: string }> {
  let loaded;
  try {
    loaded = await loadImage(file);
  } catch {
    throw new Error(`画像を読み込めませんでした（${file.type || '形式不明'}）。スクショ（PNG/JPEG）を選んでください`);
  }
  const scale = Math.min(1, 2000 / Math.max(loaded.width, loaded.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(loaded.width * scale);
  canvas.height = Math.round(loaded.height * scale);
  canvas.getContext('2d')!.drawImage(loaded.img, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/jpeg', 0.85);
  return { mimeType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) };
}

/** recruit: 確認カードの「登録して募集」から開いた（ふだんの送り先を各予約に入れておく） */
export function RegisterPage({ draftId, recruit = false }: { draftId: string | null; recruit?: boolean }) {
  const { me, toast, setPractices } = useApp();
  const [phase, setPhase] = useState<null | 'reading' | 'saving'>(null);
  const [rows, setRows] = useState<FormRow[]>(() => [emptyRow({ date: addDays(toJstDate(new Date()), 7) })]);
  // 募集先は予約ごとに、その予約の欄で選ぶ（空なら登録だけ）。2件以上なら下でまとめて付け外しもできる
  // 延長（既存の練習を伸ばす）と登録済みの予約には募集を送らないので、選べるのは新しく登録する予約だけ
  const pickable = (r: FormRow) => r.kind !== 'duplicate' && r.kind !== 'extension';
  const recruiting = rows.some((r) => pickable(r) && r.groups.length > 0);
  const setRowGroups = (key: number, g: string[]) => setRows((rs) => rs.map((x) => (x.key === key ? { ...x, groups: g } : x)));
  /** まとめて選ぶ：押したグループを、選べる予約すべてに付ける（すべてに付いていれば外す） */
  const allHave = (g: string) => rows.filter(pickable).every((r) => r.groups.includes(g));
  const toggleAll = (g: string) => {
    const on = !allHave(g);
    setRows((rs) => rs.map((r) => (pickable(r) ? { ...r, groups: on ? [...new Set([...r.groups, g])] : r.groups.filter((x) => x !== g) } : r)));
  };
  /** まとめた予約を、まとめる前の予約に分ける（続けて取った予約を別々の募集先に送るとき） */
  const splitRow = (r: FormRow) =>
    setRows((rs) =>
      rs.flatMap((x) => {
        if (x.key !== r.key || !r.parts) return [x];
        return r.parts.map((p, i) => {
          // 1つ目が既存の練習の延長なら、それは延長のまま（募集は送らない）
          const ext = i === 0 && r.kind === 'extension';
          return { ...fromReservation(p, ext ? 'extension' : undefined, ext ? [] : r.groups), max: r.max, min: r.min, memo: r.memo };
        });
      }),
    );
  const [loading, setLoading] = useState(!!draftId);
  const [run, busy] = useRunner();
  const [pasted, setPasted] = useState('');
  const [textOpen, setTextOpen] = useState(false);

  useEffect(() => {
    if (!draftId) return;
    run(() => api('getDraft', { id: draftId })).then((d) => {
      setLoading(false);
      if (!d) {
        toast('確認カードの期限が切れています。もう一度入力してください', true);
        return;
      }
      // 「登録して募集」から開いたら、新しく登録する予約にふだんの送り先を入れておく（延長には募集を送らない）
      const g = (kind: string) => (recruit && kind !== 'extension' && kind !== 'duplicate' ? d.groups : []);
      setRows([...d.items.map((i) => fromReservation(i.reservation, i.kind, g(i.kind), i.parts)), ...d.incomplete.map((r) => fromReservation(r, 'incomplete', g('incomplete')))]);
    });
  }, [draftId]);

  if (loading) return <><TopBar title="スタジオ予約登録" back /><Spinner /></>;

  /** スタジオ代が空欄か自動で入れたものなら、標準料金（曜日・時間帯ごとの料金表）で入れ直す */
  const autoFee = (r: FormRow): FormRow => {
    if (!r.feeAuto && r.fee !== '') return r;
    const std = r.studio ? defaultFee(me.settings, r) : 0;
    return { ...r, fee: std ? String(std) : '', feeAuto: true };
  };
  const update = (key: number, k: keyof FormRow, value: string) =>
    setRows((rs) =>
      rs.map((r) => {
        if (r.key !== key) return r;
        // 日時・場所を変えたら延長などの判定が変わるので外す。日時・場所・料金を変えたら、まとめる前の予約（「分ける」）も外す
        const moved = k === 'date' || k === 'start' || k === 'end' || k === 'room';
        const next = moved
          ? { ...r, [k]: value, kind: r.kind === 'incomplete' ? ('incomplete' as const) : undefined, parts: undefined }
          : k === 'fee'
            ? { ...r, [k]: value, parts: undefined }
            : { ...r, [k]: value };
        // 開始を変えたら、終了が開始の1時間後より前にならないようにそろえる
        if (k === 'start') next.end = endAfterStart(value, r.end);
        return k === 'fee' ? { ...next, feeAuto: false } : k === 'date' || k === 'start' || k === 'end' || k === 'room' ? autoFee(next) : next;
      }),
    );

  /** スクショか文章から読み取って、入力欄を置き換える */
  const parse = async (params: { images?: { mimeType: string; data: string }[]; text?: string }) => {
    setPhase('reading');
    const res = await run(() => api('parseReservations', params));
    setPhase(null);
    if (!res) return false;
    const next = [...res.items.map((i) => fromReservation(i.reservation, i.kind, [], i.parts)), ...res.incomplete.map((r) => fromReservation(r, 'incomplete'))];
    // 登録済み・終了した予約はサーバーで除かれている。件数だけ伝える
    const skipped = skippedNote(res);
    if (next.length === 0) {
      toast(`新しく登録する予約はありませんでした。${skipped || '手で入力してください。'}`, true);
      return false;
    }
    setRows(next);
    toast(`${next.length}件を読み取りました。${skipped}内容を確かめてください`);
    return true;
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setPhase('reading');
    const images = await run(() => Promise.all([...files].slice(0, 5).map(shrink)));
    if (images) await parse({ images });
    else setPhase(null);
  };

  const onText = async () => {
    if (await parse({ text: pasted })) {
      setPasted('');
      setTextOpen(false);
    }
  };

  const submit = async () => {
    const items: NewPracticeInput[] = rows
      .filter((r) => r.kind !== 'duplicate')
      .map((r) => ({
        date: r.date,
        start: r.start,
        end: r.end,
        studio: r.studio.trim(),
        room: r.room.trim(),
        fee: r.fee.trim() ? Number(r.fee) : null,
        max: r.max.trim() ? Number(r.max) : null,
        min: r.min.trim() ? Number(r.min) : null,
        memo: r.memo,
        groups: pickable(r) ? r.groups : [],
      }));
    if (items.length === 0) return toast('登録する練習がありません', true);
    if (me.actAs === 'test' && recruiting && !confirm('確認用アカウント「admin」として、グループに募集を送ります。よろしいですか？')) return;
    setPhase('saving');
    const res = await run(() => api('createPractices', { items, groups: [], draftId: draftId ?? undefined }));
    setPhase(null);
    if (!res) return;
    if (res.practices) setPractices(res.practices, true); // 一覧を取り直さずにすぐ反映
    const parts = [
      res.created.length && (res.recruited?.length ? `${res.created.length}件を登録して募集しました` : `${res.created.length}件を登録しました`),
      res.extended.length && `${res.extended.length}件を延長しました`,
      res.skipped.length && `${res.skipped.length}件は登録済みでした`,
    ].filter(Boolean);
    const names = (ids: string[]) => ids.map((g) => me.groups.find((x) => x.id === g)?.name ?? g).join('、');
    if (res.notRecruited?.length) toast(`${parts.join('・')}。${names(res.notRecruited)}には募集を送れませんでした（アプリの「募集」から送り直せます）`, true);
    else toast(parts.join('・') || '登録しました');
    // 登録は「募集」の中にあるので、続けて募集できるよう「募集」に戻る
    go('/recruit');
  };

  return (
    <>
      <TopBar title="スタジオ予約登録" back />
      {phase === 'reading' && <BusyOverlay message="読み取り中" />}
      {phase === 'saving' && <BusyOverlay message={recruiting ? '登録して募集中' : '登録中'} />}

      <div class="sources">
        <label class="source primary">
          <input type="file" accept="image/*" multiple onChange={(e) => onFiles(e.currentTarget.files)} disabled={busy} aria-label="予約画面のスクショから入力" />
          <Icon name="camera" size={22} />
          <span>スクショから</span>
        </label>
        <button class="source" aria-expanded={textOpen} onClick={() => setTextOpen(!textOpen)}>
          <Icon name="text" size={22} />
          <span>文章から</span>
        </button>
      </div>

      {textOpen && (
        <div class="card">
          <textarea rows={5} maxLength={5000} placeholder="予約完了メールなどを貼り付け" aria-label="予約内容の文章" value={pasted} onInput={(e) => setPasted(e.currentTarget.value)} />
          <button class="btn primary block" style={{ marginTop: 10 }} disabled={busy || !pasted.trim()} onClick={onText}>
            読み取る
          </button>
        </div>
      )}

      {rows.map((r, i) => {
        return (
          <section class="draft" key={r.key} data-kind={r.kind}>
            <div class="draft-head">
              <span class="grow">{r.date ? labelDate(r.date) : String(i + 1).padStart(2, '0')}</span>
              {r.kind && KIND_TAG[r.kind] && <span class={`tag ${KIND_TAG[r.kind].cls}`}>{KIND_TAG[r.kind].label}</span>}
              {rows.length > 1 && (
                <button class="icon-btn" aria-label="この予約を削除" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>
                  <Icon name="x" size={18} />
                </button>
              )}
            </div>
            <label class="field">
              <span>日付</span>
              <input type="date" value={r.date} onInput={(e) => update(r.key, 'date', e.currentTarget.value)} />
            </label>
            <div class="grid2">
              <label class="field">
                <span>開始</span>
                <input type="time" value={r.start} onInput={(e) => update(r.key, 'start', e.currentTarget.value)} />
              </label>
              <label class="field">
                <span>終了</span>
                <input type="time" value={r.end} onInput={(e) => update(r.key, 'end', e.currentTarget.value)} />
              </label>
            </div>
            <div class="field">
              <span>スタジオ</span>
              <StudioSelect
                studios={me.settings.studios}
                value={r.studio}
                onChange={(v) => setRows((rs) => rs.map((x) => (x.key === r.key ? autoFee({ ...x, studio: v, room: v === x.studio ? x.room : '', kind: x.kind === 'incomplete' ? 'incomplete' : undefined, parts: undefined }) : x)))}
              />
            </div>
            <div class="field">
              <span>部屋</span>
              <RoomSelect key={r.studio} studios={me.settings.studios} studio={r.studio} value={r.room} onChange={(v) => update(r.key, 'room', v)} />
            </div>
            <RoomInfo studios={me.settings.studios} studio={r.studio} room={r.room} style={{ marginTop: -4, marginBottom: 10 }} />
            <label class="field">
              <span>
                スタジオ代 ¥{r.feeAuto && r.fee !== '' && <span class="tag soft" title="スタジオの料金表（曜日・時間帯）から計算">自動</span>}
              </span>
              <input type="number" inputMode="numeric" placeholder="金額" value={r.fee} onInput={(e) => update(r.key, 'fee', e.currentTarget.value)} />
            </label>
            <details style={{ marginBottom: 8 }}>
              <summary class="more-summary">
                <Icon name="plus" size={16} />
                人数・メモ
              </summary>
              <div class="grid2" style={{ marginTop: 8 }}>
                <label class="field">
                  <span>上限</span>
                  <input type="number" inputMode="numeric" placeholder="なし" value={r.max} onInput={(e) => update(r.key, 'max', e.currentTarget.value)} />
                </label>
                <label class="field">
                  <span>最低</span>
                  <input type="number" inputMode="numeric" placeholder={`標準 ${me.settings.minDefault}人`} value={r.min} onInput={(e) => update(r.key, 'min', e.currentTarget.value)} />
                </label>
              </div>
              <label class="field">
                <span>メモ</span>
                <input type="text" placeholder="例：ショーケースの通し" value={r.memo} onInput={(e) => update(r.key, 'memo', e.currentTarget.value)} />
              </label>
            </details>
            {r.parts && r.parts.length > 1 && (
              <div class="row muted" style={{ marginBottom: 10 }}>
                <span class="grow">続けて取った予約{r.parts.length}件をまとめています</span>
                <button class="btn small" onClick={() => splitRow(r)}>
                  分ける
                </button>
              </div>
            )}
            {me.groups.length > 0 && pickable(r) && (
              <div class="field">
                <span>募集先（選ばなければ登録だけ）</span>
                <GroupToggles groups={me.groups} defaults={me.member.defaultGroups} value={r.groups} onChange={(g) => setRowGroups(r.key, g)} />
              </div>
            )}
          </section>
        );
      })}

      <button class="add-row" onClick={() => setRows([...rows, emptyRow({ ...rows.at(-1), kind: undefined, parts: undefined, date: rows.at(-1)?.date ? addDays(rows.at(-1)!.date, 7) : '' })])}>
        <Icon name="plus" size={18} />
        予約を追加
      </button>

      {me.groups.length > 0 && rows.filter(pickable).length > 1 && (
        <>
          <div class="sec-head">
            <Icon name="send" size={18} />
            すべての予約の募集先
          </div>
          <div class="toggles">
            {me.groups.map((g) => (
              <button class="toggle" aria-pressed={allHave(g.id)} onClick={() => toggleAll(g.id)}>
                {g.name}
              </button>
            ))}
          </div>
          <div class="muted" style={{ marginTop: 6 }}>
            押すと、すべての予約に付けたり外したりします。予約ごとに変えるときは、それぞれの予約の「募集先」で選んでください
          </div>
        </>
      )}

      {recruit && !recruiting && me.groups.length > 0 && (
        <div class="muted" style={{ marginTop: 12 }}>
          募集するときは、予約ごとの「募集先」でグループを選んでください（選ばなければ登録だけ）
        </div>
      )}
      <button class="btn primary block submit" disabled={busy} onClick={submit}>
        {recruiting ? <><Icon name="send" size={18} />登録して募集</> : <><Icon name="check" size={18} />登録</>}
      </button>
    </>
  );
}

/** 募集先のグループを選ぶチップ。点はふだんの送り先 */
function GroupToggles({ groups, defaults, value, onChange }: { groups: { id: string; name: string }[]; defaults: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div class="toggles">
      {groups.map((g) => (
        <button class="toggle" aria-pressed={value.includes(g.id)} onClick={() => onChange(value.includes(g.id) ? value.filter((x) => x !== g.id) : [...value, g.id])}>
          {g.name}
          {defaults.includes(g.id) && <span class="dot" title="ふだんの送り先" />}
        </button>
      ))}
    </div>
  );
}
