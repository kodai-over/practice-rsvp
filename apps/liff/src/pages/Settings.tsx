import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_STUDIOS, isAdmin, type CancelRule, type FeeRule, type Member, type Role, type StudioDef } from '@pb/shared';
import { api } from '../api';
import { Spinner, TopBar, go, useApp, useRunner } from '../ui';

export function SettingsPage() {
  const { me, setMe } = useApp();
  const [name, setName] = useState(me.member.name);
  const [run, busy] = useRunner();

  return (
    <>
      <TopBar title="設定" back />
      <div class="section-title">表示名</div>
      <section class="card">
        <div class="muted" style={{ marginBottom: 8 }}>
          一覧に出る名前です。絵文字やあだ名で分かりにくいときだけ変えてください。
        </div>
        <div class="row">
          <input type="text" class="grow" value={name} maxLength={20} onInput={(e) => setName(e.currentTarget.value)} />
          <button
            class="btn primary"
            disabled={busy || !name.trim() || name === me.member.name}
            onClick={async () => {
              const m = await run(() => api('setDisplayName', { name }), '保存しました');
              if (m) setMe({ ...me, member: m });
            }}
          >
            保存
          </button>
        </div>
      </section>
      <div class="section-title">改善要望</div>
      <section class="card">
        <div class="muted" style={{ marginBottom: 8 }}>
          こうなったら便利、ここが使いにくい、などを送れます。送った要望は名前と一緒にメンバー全員に表示されます。
        </div>
        <button class="btn block" onClick={() => go('/feedback')}>
          要望を見る・送る
        </button>
      </section>

      <p class="muted">権限: {me.member.role}</p>
      {isAdmin(me.member) && (
        <button class="btn block" onClick={() => go('/admin')}>
          管理（グループ・メンバー・スタジオ）
        </button>
      )}
    </>
  );
}

export function AdminPage() {
  const { me, setMe } = useApp();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [run, busy] = useRunner();
  const [studios, setStudios] = useState<StudioDef[]>(me.settings.studios);
  const [fees, setFees] = useState<FeeRule[]>(me.settings.fees);
  const [rules, setRules] = useState<CancelRule[]>(me.settings.cancelRules);
  const [minDefault, setMinDefault] = useState(String(me.settings.minDefault));
  const [roundUnit, setRoundUnit] = useState(String(me.settings.roundUnit));

  useEffect(() => {
    run(() => api('listMembers')).then((m) => m && setMembers(m));
  }, []);

  if (!isAdmin(me.member)) return <><TopBar title="管理" back /><div class="empty">管理者だけが使えます</div></>;

  const saveMember = async (userId: string, patch: Partial<Pick<Member, 'role' | 'defaultGroups'>>) => {
    const m = await run(() => api('updateMember', { userId, patch }), '保存しました');
    if (m) setMembers((ms) => ms!.map((x) => (x.userId === userId ? m : x)));
  };

  return (
    <>
      <TopBar title="管理" back />

      <div class="section-title">グループ（Botが入っているグループ）</div>
      <section class="card">
        {me.groups.length === 0 && <div class="muted">Botをグループに招待すると、ここに出ます</div>}
        {me.groups.map((g) => (
          <GroupRow
            key={g.id}
            name={g.name}
            busy={busy}
            onSave={async (name) => {
              const groups = await run(() => api('renameGroup', { id: g.id, name }), '保存しました');
              if (groups) setMe({ ...me, groups, settings: { ...me.settings, groups } });
            }}
          />
        ))}
      </section>

      <div class="section-title">メンバー（権限・ふだんの送り先）</div>
      {members == null ? (
        <Spinner />
      ) : (
        members.map((m) => (
          <section class="card" key={m.userId}>
            <div class="row">
              <strong class="grow">{m.name}</strong>
              <select style={{ width: 'auto' }} value={m.role} disabled={busy} onChange={(e) => saveMember(m.userId, { role: e.currentTarget.value as Role })}>
                <option>一般</option>
                <option>予約者</option>
                <option>管理者</option>
              </select>
            </div>
            {me.groups.map((g) => (
                <label class="check">
                  <input
                    type="checkbox"
                    checked={m.defaultGroups.includes(g.id)}
                    disabled={busy}
                    onChange={(e) =>
                      saveMember(m.userId, { defaultGroups: e.currentTarget.checked ? [...m.defaultGroups, g.id] : m.defaultGroups.filter((x) => x !== g.id) })
                    }
                  />
                  {g.name}に募集
                </label>
            ))}
          </section>
        ))
      )}

      <StudioEditor studios={studios} onChange={setStudios} />

      <div class="section-title">スタジオの標準料金（部屋が空欄なら全部屋）</div>
      <section class="card">
        {fees.map((f, i) => (
          <div class="grid3" style={{ marginBottom: 8 }}>
            <input type="text" placeholder="スタジオ" value={f.studio} onInput={(e) => setFees(fees.map((x, j) => (j === i ? { ...x, studio: e.currentTarget.value } : x)))} />
            <input type="text" placeholder="部屋" value={f.room} onInput={(e) => setFees(fees.map((x, j) => (j === i ? { ...x, room: e.currentTarget.value } : x)))} />
            <input type="number" placeholder="円" value={f.fee} onInput={(e) => setFees(fees.map((x, j) => (j === i ? { ...x, fee: Number(e.currentTarget.value) } : x)))} />
          </div>
        ))}
        <button class="btn small" onClick={() => setFees([...fees, { studio: '', room: '', fee: 0 }])}>
          ＋ 行を追加
        </button>
      </section>

      <div class="section-title">キャンセル期限前警告（スタジオごと）</div>
      <section class="card">
        <div class="muted" style={{ marginBottom: 8 }}>
          利用日の何日前の何時に、人数が最低人数に届いていないことを予約者に知らせるか
        </div>
        {rules.map((r, i) => (
          <div class="grid3" style={{ marginBottom: 8 }}>
            <input type="text" placeholder="スタジオ" value={r.studio} onInput={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, studio: e.currentTarget.value } : x)))} />
            <input type="number" placeholder="日前" value={r.daysBefore} onInput={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, daysBefore: Number(e.currentTarget.value) } : x)))} />
            <input type="time" value={r.time} onInput={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, time: e.currentTarget.value } : x)))} />
          </div>
        ))}
        <button class="btn small" onClick={() => setRules([...rules, { studio: '', daysBefore: 1, time: '10:00' }])}>
          ＋ 行を追加
        </button>
      </section>

      <div class="section-title">共通</div>
      <section class="card">
        <div class="grid2">
          <label class="field">
            <span>最低人数の標準値</span>
            <input type="number" value={minDefault} onInput={(e) => setMinDefault(e.currentTarget.value)} />
          </label>
          <label class="field">
            <span>割り勘の切り上げ単位（円）</span>
            <input type="number" value={roundUnit} onInput={(e) => setRoundUnit(e.currentTarget.value)} />
          </label>
        </div>
      </section>

      <button
        class="btn primary block"
        disabled={busy}
        onClick={async () => {
          const settings = await run(
            () => api('updateSettings', { studios, fees, cancelRules: rules, minDefault: Number(minDefault), roundUnit: Number(roundUnit) }),
            '保存しました',
          );
          if (settings) {
            setMe({ ...me, settings });
            setStudios(settings.studios);
            setFees(settings.fees);
            setRules(settings.cancelRules);
          }
        }}
      >
        スタジオ・料金・期限・共通設定を保存
      </button>
    </>
  );
}

function GroupRow({ name, onSave, busy }: { name: string; onSave: (n: string) => void; busy: boolean }) {
  const [v, setV] = useState(name);
  return (
    <div class="row" style={{ marginBottom: 8 }}>
      <input type="text" class="grow" value={v} onInput={(e) => setV(e.currentTarget.value)} />
      <button class="btn small" disabled={busy || !v.trim() || v === name} onClick={() => onSave(v.trim())}>
        保存
      </button>
    </div>
  );
}

/** スタジオと部屋の一覧。スタジオ側で部屋や広さが変わったら、ここで直す（コードの変更は要らない） */
function StudioEditor({ studios, onChange }: { studios: StudioDef[]; onChange: (s: StudioDef[]) => void }) {
  const setStudio = (i: number, patch: Partial<StudioDef>) => onChange(studios.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <>
      <div class="section-title">スタジオと部屋（登録画面の選択肢・部屋の広さ）</div>
      <section class="card">
        <div class="muted" style={{ marginBottom: 8 }}>
          スタジオ側で部屋や広さが変わったら、ここで直して下の「保存」を押してください。別名はスクショの読み取りで表記ゆれを正式名称にそろえるのに使います（カンマ区切り）。
        </div>
        {studios.map((st, i) => (
          <div key={i} style={{ borderTop: i ? '1px solid var(--line)' : 'none', paddingTop: i ? 10 : 0, marginTop: i ? 10 : 0 }}>
            <div class="row" style={{ marginBottom: 6 }}>
              <input type="text" class="grow" placeholder="スタジオ名（正式名称）" value={st.name} onInput={(e) => setStudio(i, { name: e.currentTarget.value })} />
              <button class="btn small danger" onClick={() => confirm(`${st.name || 'このスタジオ'}を一覧から消しますか？`) && onChange(studios.filter((_, j) => j !== i))}>
                削除
              </button>
            </div>
            <input
              type="text"
              placeholder="別名（例：わーくる横浜, worcle横浜）"
              value={st.aliases.join(', ')}
              onInput={(e) => setStudio(i, { aliases: e.currentTarget.value.split(/[,、]/).map((x) => x.trim()).filter(Boolean) })}
            />
            {st.rooms.map((r, k) => (
              <div class="row" style={{ marginTop: 6 }}>
                <input type="text" style={{ width: '30%' }} placeholder="部屋" value={r.name} onInput={(e) => setStudio(i, { rooms: st.rooms.map((x, m) => (m === k ? { ...x, name: e.currentTarget.value } : x)) })} />
                <input type="text" class="grow" placeholder="広さ（例：46.5㎡・天井2.3m）" value={r.size} onInput={(e) => setStudio(i, { rooms: st.rooms.map((x, m) => (m === k ? { ...x, size: e.currentTarget.value } : x)) })} />
                <button class="btn small" onClick={() => setStudio(i, { rooms: st.rooms.filter((_, m) => m !== k) })}>
                  ×
                </button>
              </div>
            ))}
            <button class="btn small" style={{ marginTop: 6 }} onClick={() => setStudio(i, { rooms: [...st.rooms, { name: '', size: '' }] })}>
              ＋ 部屋を追加
            </button>
          </div>
        ))}
        <div class="row" style={{ marginTop: 12 }}>
          <button class="btn small" onClick={() => onChange([...studios, { name: '', aliases: [], rooms: [] }])}>
            ＋ スタジオを追加
          </button>
          <button
            class="btn small"
            onClick={() => confirm('スタジオと部屋の一覧を初期値（2026年10月時点の公式サイトの情報）に戻しますか？') && onChange(DEFAULT_STUDIOS.map((x) => ({ ...x, rooms: x.rooms.map((r) => ({ ...r })) })))}
          >
            初期値に戻す
          </button>
        </div>
      </section>
    </>
  );
}
