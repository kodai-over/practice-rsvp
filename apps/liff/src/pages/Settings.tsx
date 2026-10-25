import { useEffect, useState } from 'preact/hooks';
import { isAdmin, type CancelRule, type FeeRule, type Member, type Role } from '@pb/shared';
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
            {m.role !== '一般' &&
              me.groups.map((g) => (
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
            () => api('updateSettings', { fees, cancelRules: rules, minDefault: Number(minDefault), roundUnit: Number(roundUnit) }),
            '保存しました',
          );
          if (settings) {
            setMe({ ...me, settings });
            setFees(settings.fees);
            setRules(settings.cancelRules);
          }
        }}
      >
        料金・期限・共通設定を保存
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
