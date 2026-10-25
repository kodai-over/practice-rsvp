import { useEffect, useState } from 'preact/hooks';
import { addDays, defaultFee, labelDate, toJstDate, yen, type DraftItemKind, type NewPracticeInput, type Reservation } from '@pb/shared';
import { api } from '../api';
import { Spinner, TopBar, go, useApp, useRunner } from '../ui';

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

const KIND_LABEL: Record<string, string> = {
  extension: '既存の練習の延長として更新します',
  duplicate: '登録済みのため募集しません',
  incomplete: '読み取れなかった項目を入力してください',
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
  const { me, toast } = useApp();
  const [rows, setRows] = useState<FormRow[]>(() => [emptyRow({ date: addDays(toJstDate(new Date()), 7) })]);
  const [groups, setGroups] = useState<string[]>(() => {
    // ふだんの送り先。未設定でグループが1つしかなければ、そのグループ
    const ids = me.groups.map((g) => g.id);
    const mine = me.member.defaultGroups.filter((g) => ids.includes(g));
    return mine.length ? mine : ids.length === 1 ? ids : [];
  });
  const [loading, setLoading] = useState(!!draftId);
  const [run, busy] = useRunner();
  const [pasted, setPasted] = useState('');
  const studios = [...new Set(me.settings.fees.map((f) => f.studio))];

  useEffect(() => {
    if (!draftId) return;
    run(() => api('getDraft', { id: draftId })).then((d) => {
      setLoading(false);
      if (!d) {
        toast('確認カードの期限が切れています。もう一度入力してください', true);
        return;
      }
      setRows([...d.items.map((i) => fromReservation(i.reservation, i.kind)), ...d.incomplete.map((r) => fromReservation(r, 'incomplete'))]);
      if (d.groups.length) setGroups(d.groups);
    });
  }, [draftId]);

  if (loading) return <><TopBar title="練習を登録" back /><Spinner /></>;

  const update = (key: number, k: keyof FormRow, value: string) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [k]: value, kind: r.kind === 'incomplete' ? 'incomplete' : undefined } : r)));

  /** スクショか文章から読み取って、入力欄を置き換える */
  const parse = async (params: { images?: { mimeType: string; data: string }[]; text?: string }) => {
    const res = await run(() => api('parseReservations', params));
    if (!res) return false;
    const next = [...res.items.map((i) => fromReservation(i.reservation, i.kind)), ...res.incomplete.map((r) => fromReservation(r, 'incomplete'))];
    const past = res.pastCount ? `（過去の予約${res.pastCount}件は除きました）` : '';
    if (next.length === 0) {
      toast(`登録できる今後の予約を読み取れませんでした${past}。手で入力してください`, true);
      return false;
    }
    setRows(next);
    toast(`${next.length}件を読み取りました${past}。内容を確かめてください`);
    return true;
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const images = await run(() => Promise.all([...files].slice(0, 5).map(shrink)));
    if (images) await parse({ images });
  };

  const onText = async () => {
    if (await parse({ text: pasted })) setPasted('');
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
    const res = await run(() => api('createPractices', { items, groups, draftId: draftId ?? undefined }));
    if (!res) return;
    const parts = [
      res.created.length && `${res.created.length}件を募集しました`,
      res.extended.length && `${res.extended.length}件を延長しました`,
      res.skipped.length && `${res.skipped.length}件は登録済みでした`,
    ].filter(Boolean);
    toast(parts.join('・') || '登録しました');
    go('/');
  };

  return (
    <>
      <TopBar title="練習を登録" back />

      <label class="dropzone">
        <input type="file" accept="image/*" multiple onChange={(e) => onFiles(e.currentTarget.files)} disabled={busy} />
        {busy ? '読み取り中…' : '📷 予約画面のスクショを選ぶと自動で入力します'}
        <div class="muted" style={{ marginTop: 4 }}>予約一覧のように複数の予約が写っていてもOK。電話番号などが写る部分は切り取ってください</div>
      </label>

      <details class="card" style={{ marginTop: 12 }}>
        <summary class="muted">予約完了メールなどの文章から読み取る</summary>
        <textarea
          rows={5}
          style={{ marginTop: 8 }}
          maxLength={5000}
          placeholder="予約内容の文章を貼り付けてください"
          value={pasted}
          onInput={(e) => setPasted(e.currentTarget.value)}
        />
        <button class="btn block" style={{ marginTop: 8 }} disabled={busy || !pasted.trim()} onClick={onText}>
          読み取る
        </button>
      </details>

      {rows.map((r, i) => {
        const std = r.studio ? defaultFee(me.settings, r.studio, r.room) : 0;
        return (
          <section class="card" key={r.key} style={{ marginTop: 12 }}>
            <div class="row" style={{ marginBottom: 8 }}>
              <strong class="grow">{r.date ? labelDate(r.date) : `${i + 1}件目`}</strong>
              {rows.length > 1 && (
                <button class="btn small" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>
                  削除
                </button>
              )}
            </div>
            {r.kind && KIND_LABEL[r.kind] && <div class={`kind ${r.kind}`} style={{ marginBottom: 8 }}>{KIND_LABEL[r.kind]}</div>}
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
            <div class="grid2">
              <label class="field">
                <span>スタジオ</span>
                <input type="text" list="studios" placeholder="例：worcle横浜" value={r.studio} onInput={(e) => update(r.key, 'studio', e.currentTarget.value)} />
              </label>
              <label class="field">
                <span>部屋</span>
                <input type="text" placeholder="例：A" value={r.room} onInput={(e) => update(r.key, 'room', e.currentTarget.value)} />
              </label>
            </div>
            <label class="field">
              <span>スタジオ代（円）</span>
              <input type="number" inputMode="numeric" placeholder={std ? `空欄なら標準料金 ${yen(std)}` : '金額'} value={r.fee} onInput={(e) => update(r.key, 'fee', e.currentTarget.value)} />
            </label>
            <details>
              <summary class="muted">上限・最低人数・メモ（任意）</summary>
              <div class="grid2" style={{ marginTop: 8 }}>
                <label class="field">
                  <span>上限人数</span>
                  <input type="number" inputMode="numeric" placeholder="なし" value={r.max} onInput={(e) => update(r.key, 'max', e.currentTarget.value)} />
                </label>
                <label class="field">
                  <span>最低人数</span>
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
      <datalist id="studios">
        {studios.map((s) => (
          <option value={s} />
        ))}
      </datalist>

      <button class="btn block" style={{ marginTop: 4 }} onClick={() => setRows([...rows, emptyRow({ ...rows.at(-1), key: undefined, kind: undefined, date: rows.at(-1)?.date ? addDays(rows.at(-1)!.date, 7) : '' })])}>
        ＋ 日を追加
      </button>

      <div class="section-title">送り先グループ</div>
      <section class="card">
        {me.groups.length === 0 && <div class="muted">Botが入っているグループがありません</div>}
        {me.groups.map((g) => (
          <label class="check">
            <input
              type="checkbox"
              checked={groups.includes(g.id)}
              onChange={(e) => setGroups(e.currentTarget.checked ? [...groups, g.id] : groups.filter((x) => x !== g.id))}
            />
            {g.name}
          </label>
        ))}
      </section>

      <button class="btn primary block" style={{ marginTop: 16 }} disabled={busy} onClick={submit}>
        募集
      </button>
    </>
  );
}
