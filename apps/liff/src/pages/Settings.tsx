import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_STUDIOS, isAdmin, type CancelRule, type FeeDays, type FeeRule, type Member, type Role, type StudioDef } from '@studio-attendance/shared';
import { api } from '../api';
import { Avatar, Icon, Spinner, TopBar, go, useApp, useRunner } from '../ui';

export function SettingsPage() {
  const { me, setMe } = useApp();
  const [name, setName] = useState(me.member.name);
  const [run, busy] = useRunner();

  const [editing, setEditing] = useState(false);
  const save = async () => {
    const m = await run(() => api('setDisplayName', { name: name.trim() }), '保存しました');
    if (m) {
      setMe({ ...me, member: m });
      setEditing(false);
    }
  };

  return (
    <>
      <TopBar />
      <div class="profile">
        <Avatar name={me.member.name} />
        <div>
          <div class="name">{me.member.name}</div>
          <span class="pill">{me.member.role}</span>
        </div>
      </div>

      <div class="field">
        <span>表示名</span>
        {editing ? (
          <form
            class="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <input type="text" value={name} maxLength={20} aria-label="表示名" autoFocus onInput={(e) => setName(e.currentTarget.value)} />
            <button class="round-btn" aria-label="保存" disabled={busy || !name.trim() || name === me.member.name}>
              <Icon name="check" />
            </button>
          </form>
        ) : (
          <button class="menu-row name-row" onClick={() => setEditing(true)}>
            <span class="grow">{me.member.name}</span>
            <Icon name="edit" size={20} />
          </button>
        )}
      </div>

      {isAdmin(me.member) && (
        <ul class="menu" style={{ marginTop: 24 }}>
          <li>
            <button class="menu-row" onClick={() => go('/admin')}>
              <Icon name="gear" size={20} />
              <span class="grow">管理</span>
              <span class="val">グループ・メンバー・スタジオ</span>
              <Icon name="chevron" size={18} />
            </button>
          </li>
        </ul>
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
  const setFee = (i: number, patch: Partial<FeeRule>) => setFees(fees.map((x, j) => (j === i ? { ...x, ...patch } : x)));
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

      <div class="section-title">グループ</div>
      <section class="card">
        {me.groups.length === 0 ? (
          <div class="muted">Botをグループに招待すると出ます</div>
        ) : (
          <div class="muted" style={{ marginBottom: 8 }}>
            名前はLINEのグループ名に1時間ごとにそろえます
          </div>
        )}
        {me.groups.map((g) => (
          <div key={g.id} style={{ marginBottom: 8 }}>
            {g.name}
          </div>
        ))}
      </section>

      <div class="section-title">メンバー</div>
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

      <div class="section-title">標準料金（30分あたり）</div>
      <section class="card">
        <div class="muted" style={{ marginBottom: 10 }}>
          登録時にスタジオ代を自動で入れます。部屋が空欄＝全部屋、時間が空欄＝終日
        </div>
        {fees.map((f, i) => (
          <div class="fee-rule">
            <div class="grid3">
              <input type="text" placeholder="スタジオ" value={f.studio} onInput={(e) => setFee(i, { studio: e.currentTarget.value })} />
              <input type="text" placeholder="部屋" value={f.room} onInput={(e) => setFee(i, { room: e.currentTarget.value })} />
              <select value={f.days ?? ''} onChange={(e) => setFee(i, { days: e.currentTarget.value as FeeDays })}>
                <option value="">毎日</option>
                <option value="平日">平日</option>
                <option value="土日祝">土日祝</option>
              </select>
            </div>
            <div class="grid3" style={{ marginTop: 6 }}>
              <input type="text" inputMode="numeric" placeholder="開始 17:00" value={f.from ?? ''} onInput={(e) => setFee(i, { from: e.currentTarget.value })} />
              <input type="text" inputMode="numeric" placeholder="終了 23:30" value={f.to ?? ''} onInput={(e) => setFee(i, { to: e.currentTarget.value })} />
              <input type="number" placeholder="円/30分" value={f.fee} onInput={(e) => setFee(i, { fee: Number(e.currentTarget.value) })} />
            </div>
            <button class="btn small danger" style={{ marginTop: 6 }} onClick={() => setFees(fees.filter((_, j) => j !== i))}>
              削除
            </button>
          </div>
        ))}
        <button class="btn small" onClick={() => setFees([...fees, { studio: '', room: '', days: '', from: '', to: '', fee: 0 }])}>
          ＋ 追加
        </button>
      </section>

      <div class="section-title">キャンセル期限前の警告</div>
      <section class="card">
        <div class="muted" style={{ marginBottom: 8 }}>
          スタジオ・何日前・何時に、最低人数未満を予約者に知らせる
        </div>
        {rules.map((r, i) => (
          <div class="grid3" style={{ marginBottom: 8 }}>
            <input type="text" placeholder="スタジオ" value={r.studio} onInput={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, studio: e.currentTarget.value } : x)))} />
            <input type="number" placeholder="日前" value={r.daysBefore} onInput={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, daysBefore: Number(e.currentTarget.value) } : x)))} />
            <input type="time" value={r.time} onInput={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, time: e.currentTarget.value } : x)))} />
          </div>
        ))}
        <button class="btn small" onClick={() => setRules([...rules, { studio: '', daysBefore: 1, time: '10:00' }])}>
          ＋ 追加
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
        保存
      </button>
    </>
  );
}

/** スタジオと部屋の一覧。スタジオ側で部屋や広さが変わったら、ここで直す（コードの変更は要らない） */
function StudioEditor({ studios, onChange }: { studios: StudioDef[]; onChange: (s: StudioDef[]) => void }) {
  const setStudio = (i: number, patch: Partial<StudioDef>) => onChange(studios.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <>
      <div class="section-title">スタジオと部屋</div>
      <section class="card">
        <div class="muted" style={{ marginBottom: 8 }}>
          別名（カンマ区切り）は読み取りの表記ゆれをそろえます
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
