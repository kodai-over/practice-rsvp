import { useEffect, useState } from 'preact/hooks';
import { addDays, defaultFee, labelDate, skippedNote, toJstDate, type DraftItemKind, type NewPracticeInput, type Reservation } from '@studio-attendance/shared';
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
}

let seq = 0;
const emptyRow = (over: Partial<FormRow> = {}): FormRow => ({
  key: ++seq,
  date: '',
  start: '19:00',
  end: '21:00',
  studio: '',
  room: '',
  fee: '',
  max: '',
  min: '',
  memo: '',
  ...over,
});
const fromReservation = (r: Partial<Reservation>, kind: FormRow['kind']): FormRow =>
  emptyRow({ date: r.date ?? '', start: r.start ?? '', end: r.end ?? '', studio: r.studio ?? '', room: r.room ?? '', fee: r.fee != null ? String(r.fee) : '', kind });

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

export function RegisterPage({ draftId }: { draftId: string | null }) {
  const { me, toast, setPractices } = useApp();
  const [phase, setPhase] = useState<null | 'reading' | 'saving'>(null);
  const [rows, setRows] = useState<FormRow[]>(() => [emptyRow({ date: addDays(toJstDate(new Date()), 7) })]);
  // 登録がメイン。グループへの募集は、選んだときだけ
  const [groups, setGroups] = useState<string[]>([]);
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
      setRows([...d.items.map((i) => fromReservation(i.reservation, i.kind)), ...d.incomplete.map((r) => fromReservation(r, 'incomplete'))]);
    });
  }, [draftId]);

  if (loading) return <><TopBar title="スタジオ予約登録" /><Spinner /></>;

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
        const next = { ...r, [k]: value, kind: r.kind === 'incomplete' ? ('incomplete' as const) : undefined };
        return k === 'fee' ? { ...next, feeAuto: false } : k === 'date' || k === 'start' || k === 'end' || k === 'room' ? autoFee(next) : next;
      }),
    );

  /** スクショか文章から読み取って、入力欄を置き換える */
  const parse = async (params: { images?: { mimeType: string; data: string }[]; text?: string }) => {
    setPhase('reading');
    const res = await run(() => api('parseReservations', params));
    setPhase(null);
    if (!res) return false;
    const next = [...res.items.map((i) => fromReservation(i.reservation, i.kind)), ...res.incomplete.map((r) => fromReservation(r, 'incomplete'))];
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
      }));
    if (items.length === 0) return toast('登録する練習がありません', true);
    setPhase('saving');
    const res = await run(() => api('createPractices', { items, groups, draftId: draftId ?? undefined }));
    setPhase(null);
    if (!res) return;
    if (res.practices) setPractices(res.practices, true); // 一覧を取り直さずにすぐ反映
    const parts = [
      res.created.length && (groups.length ? `${res.created.length}件を登録して募集しました` : `${res.created.length}件を登録しました`),
      res.extended.length && `${res.extended.length}件を延長しました`,
      res.skipped.length && `${res.skipped.length}件は登録済みでした`,
    ].filter(Boolean);
    toast(parts.join('・') || '登録しました');
    go('/');
  };

  return (
    <>
      <TopBar title="スタジオ予約登録" />
      {phase === 'reading' && <BusyOverlay message="読み取り中" />}
      {phase === 'saving' && <BusyOverlay message={groups.length ? '登録して募集中' : '登録中'} />}

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
                onChange={(v) => setRows((rs) => rs.map((x) => (x.key === r.key ? autoFee({ ...x, studio: v, room: v === x.studio ? x.room : '', kind: x.kind === 'incomplete' ? 'incomplete' : undefined }) : x)))}
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
          </section>
        );
      })}

      <button class="add-row" onClick={() => setRows([...rows, emptyRow({ ...rows.at(-1), key: undefined, kind: undefined, date: rows.at(-1)?.date ? addDays(rows.at(-1)!.date, 7) : '' })])}>
        <Icon name="plus" size={18} />
        予約を追加
      </button>

      {me.groups.length > 0 && (
        <>
          <div class="sec-head">
            <Icon name="send" size={18} />
            募集も送る
          </div>
          <div class="toggles">
            {me.groups.map((g) => (
              <button class="toggle" aria-pressed={groups.includes(g.id)} onClick={() => setGroups(groups.includes(g.id) ? groups.filter((x) => x !== g.id) : [...groups, g.id])}>
                {g.name}
                {me.member.defaultGroups.includes(g.id) && <span class="dot" title="ふだんの送り先" />}
              </button>
            ))}
          </div>
        </>
      )}

      <button class="btn primary block submit" disabled={busy} onClick={submit}>
        {groups.length ? <><Icon name="send" size={18} />登録して募集</> : <><Icon name="check" size={18} />登録</>}
      </button>
    </>
  );
}
