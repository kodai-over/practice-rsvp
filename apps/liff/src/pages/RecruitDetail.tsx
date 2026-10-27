import { useState } from 'preact/hooks';
import type { AttendeeView, PracticeView } from '@studio-attendance/shared';
import { api } from '../api';
import { Avatar, Icon, Spinner, Syncing, TopBar, go, useApp } from '../ui';
import { EditForm, PracticePass, usePractice } from './Detail';

/** 「募集」から開く練習の画面。募集先のグループ・ゲストの追加・参加リンク・（予約者と管理者は）編集と削除 */
export function RecruitDetailPage({ id }: { id: string }) {
  const { me, setPractices } = useApp();
  const { v, loading, run, busy, update } = usePractice(id);
  if (!v) return <><TopBar back />{loading ? <Spinner /> : <div class="empty">練習が見つかりません</div>}</>;
  const guests = [...v.going, ...v.maybe, ...v.notGoing].filter((a) => a.kind === 'ゲスト');
  const remove = (a: AttendeeView) => update(() => api('removeAttendance', { id, participant: a.participant }), '取り消しました');

  return (
    <>
      <TopBar back>{loading && <Syncing />}</TopBar>
      <PracticePass v={v} />

      {(v.practice.status === '募集中' || v.practice.status === '満員') && (
        <RecruitForm v={v} busy={busy} onSend={async (groups) => {
            if (me.actAs === 'test' && !confirm('確認用アカウント「admin」として、グループに募集を送ります。よろしいですか？')) return;
            await update(() => api('recruitPractice', { id, groups }), 'グループに募集を送りました');
          }} />
      )}

      <section>
        <div class="sec-head">
          <Icon name="people" size={18} />
          ゲスト
          {guests.length > 0 && <span class="n">{guests.length}</span>}
        </div>
        {guests.length > 0 && (
          <div class="people" style={{ marginBottom: 10 }}>
            {guests.map((a) => (
              <span class="person">
                <Avatar name={a.name} guest />
                <span>{a.name}</span>
                {a.canRemove && (
                  <button class="x" aria-label={`${a.name}さんを取り消す`} onClick={() => confirm(`${a.name}さんを取り消しますか？`) && remove(a)}>
                    <Icon name="x" size={14} />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        <GuestForm onAdd={(name) => update(() => api('addGuest', { id, name }), `${name}さんを追加しました`)} busy={busy} />
      </section>

      {v.joinUrl && <JoinLink url={v.joinUrl} />}

      {v.canEdit && (
        <EditForm
          v={v}
          busy={busy}
          onSave={(patch) => update(() => api('updatePractice', { id, patch }), '保存しました')}
          onDelete={async () => {
            const list = await run(() => api('deletePractice', { id }), '削除しました');
            if (list) {
              setPractices(list, true);
              go('/recruit');
            }
          }}
        />
      )}
    </>
  );
}

function GuestForm({ onAdd, busy }: { onAdd: (name: string) => Promise<unknown>; busy: boolean }) {
  const [name, setName] = useState('');
  return (
    <form
      class="inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (name.trim() && (await onAdd(name.trim()))) setName('');
      }}
    >
      <input type="text" placeholder="名前" aria-label="ゲストの名前" value={name} onInput={(e) => setName(e.currentTarget.value)} maxLength={30} />
      <button class="round-btn" aria-label="ゲストを追加" disabled={busy || !name.trim()}>
        <Icon name="plus" />
      </button>
    </form>
  );
}

/** グループへの募集。いつも出し、グループがない・送れない人にはその旨を一行だけ出す */
function RecruitForm({ v, onSend, busy }: { v: PracticeView; onSend: (groups: string[]) => Promise<unknown>; busy: boolean }) {
  const { me } = useApp();
  const [picked, setPicked] = useState<string[]>([]);
  const sent = (gid: string) => v.practice.groups.includes(gid);
  const canSend = v.canEdit && me.groups.some((g) => !sent(g.id));
  return (
    <section>
      <div class="sec-head">
        <Icon name="send" size={18} />
        グループに募集
      </div>
      {me.groups.length === 0 ? (
        <p class="note">Botをグループに招待すると送れます</p>
      ) : (
        <>
          <div class="toggles">
            {me.groups.map((g) =>
              sent(g.id) || !v.canEdit ? (
                <button class="toggle" disabled aria-label={`${g.name}（${sent(g.id) ? '募集済み' : '未募集'}）`}>
                  {sent(g.id) && <Icon name="check" size={16} />}
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
          {!v.canEdit && <p class="note">送れるのは登録した人と管理者です</p>}
          {canSend && (
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
        </>
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

