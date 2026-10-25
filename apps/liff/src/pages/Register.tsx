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

/** スクショを縮小して base64 に（送るデータを小さくする） */
async function shrink(file: File): Promise<{ mimeType: string; data: string }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/jpeg', 0.85);
  return { mimeType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) };
}

export function RegisterPage({ draftId }: { draftId: string | null }) {
  const { me, toast } = useApp();
  const [rows, setRows] = useState<FormRow[]>(() => [emptyRow({ date: addDays(toJstDate(new Date()), 7) })]);
  const [groups, setGroups] = useState<string[]>(me.member.defaultGroups);
  const [loading, setLoading] = useState(!!draftId);
  const [run, busy] = useRunner();
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

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const res = await run(async () => api('parseScreenshot', { images: await Promise.all([...files].slice(0, 5).map(shrink)) }));
    if (!res) return;
    const next = [...res.items.map((i) => fromReservation(i.reservation, i.kind)), ...res.incomplete.map((r) => fromReservation(r, 'incomplete'))];
    if (next.length === 0) toast('予約内容を読み取れませんでした。手で入力してください', true);
    else {
      setRows(next);
      toast(`${next.length}件を読み取りました。内容を確かめてください`);
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
        <div class="muted" style={{ marginTop: 4 }}>電話番号などが写る部分は切り取ってから選んでください</div>
      </label>

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
