import { useEffect, useState } from 'preact/hooks';
import { answerReport } from '@studio-attendance/shared';
import { api } from '../api';
import { canSendToChat, closeApp, sendToChat } from '../liff';
import { Icon, Spinner, Syncing, TopBar, go, useApp, useRunner } from '../ui';
import { PracticeCard, useAnswer } from './List';

/** 募集カードの「RSVP」から開く画面。その募集の練習だけを並べ、答えたらグループに伝えられる */
export function AnswerPage({ ids: raw }: { ids: string[] }) {
  const { practices: list, practicesAt, setPractices, toast } = useApp();
  const ids = [...new Set(raw)];
  const [run, busy] = useRunner();
  const answer = useAnswer(run);
  const [send, sending] = useRunner();
  // 最新の一覧を取り終えたか。前回の表示の回答のまま送らないよう、取れるまでは答えも送信も止める
  // 起動時や直前に取ったばかりなら、取り直さない
  const [load, setLoad] = useState<'loading' | 'ok' | 'error'>(() => (practicesAt > 0 && Date.now() - practicesAt < 30_000 ? 'ok' : 'loading'));
  const reload = () => {
    setLoad('loading');
    run(() => api('listPractices')).then((r) => {
      if (r) setPractices(r, true);
      setLoad(r ? 'ok' : 'error');
    });
  };
  useEffect(() => {
    if (load === 'loading') reload();
  }, []);
  const fresh = load === 'ok';
  // グループに送る文。書き換えるまでは回答に合わせて作り直し、書き換えたらそのまま残す
  const [draft, setDraft] = useState<string | null>(null);

  const found = ids.map((id) => list?.find((v) => v.practice.id === id)).filter((v) => v != null);
  // 前回の表示に無い練習（募集されたばかりのもの）は、最新を取り終わるまで待つ
  if (list == null || (found.length < ids.length && load === 'loading'))
    return (
      <>
        <TopBar title="RSVP" />
        <Spinner />
      </>
    );

  // 中止の練習は答えられないので、伝える文にも載せない
  const report = answerReport(found.filter((v) => v.practice.status !== '中止').map((v) => ({ practice: v.practice, answer: v.myAnswer }))) ?? '';
  const text = draft ?? report;
  const chat = canSendToChat();
  const tell = () =>
    send(async () => {
      try {
        await sendToChat(text.trim());
      } catch (e) {
        console.error(e);
        throw new Error('グループに送れませんでした。回答は記録されています');
      }
      toast('グループに伝えました');
      // トークに戻ると、送った発言がそのまま見える
      closeApp();
    });

  return (
    <>
      <TopBar title="RSVP">{(busy || load === 'loading') && <Syncing />}</TopBar>
      {load === 'error' && (
        <div class="empty">
          最新の出欠を読み込めませんでした
          <button class="btn primary" onClick={reload}>
            読み込み直す
          </button>
        </div>
      )}
      {load === 'error' ? null : found.length === 0 ? (
        <div class="empty">練習が見つかりません（終わった・削除された・見られない練習です）</div>
      ) : (
        found.map((v) => <PracticeCard key={v.practice.id} v={v} busy={busy || !fresh} onAnswer={(a) => answer(v.practice.id, a)} />)
      )}
      {found.length > 0 && found.length < ids.length && <p class="note">終わった・削除された・見られない練習は表示していません</p>}

      {fresh && found.length > 0 && (
        <section>
          <div class="sec-head">
            <Icon name="chat" size={18} />
            グループに伝える
          </div>
          {chat === 'outside' ? (
            <p class="note">回答は記録されています。グループのトークのカードから開くと、回答したことをグループに伝えられます</p>
          ) : chat === 'noScope' ? (
            <p class="note">回答は記録されています。グループに送る設定がまだのため、伝えられません（管理者に知らせてください）</p>
          ) : (
            <>
              <label class="field">
                <span>送る文（書き換えられます）</span>
                <textarea
                  class="report"
                  rows={Math.max(3, text.split('\n').length + 1)}
                  value={text}
                  placeholder="○ △ ✕ を選ぶと、ここに文ができます"
                  maxLength={1000}
                  onInput={(e) => setDraft(e.currentTarget.value)}
                />
              </label>
              {draft != null && draft !== report && (
                <button class="btn ghost block" style={{ marginBottom: 8 }} onClick={() => setDraft(null)}>
                  回答から作り直す
                </button>
              )}
              <button class="btn primary block" disabled={!text.trim() || busy || sending || !fresh} onClick={tell}>
                <Icon name="send" size={18} />
                グループに伝える
              </button>
              <p class="note">押すと、あなたの発言としてこのトークに送ります。伝えなくても回答は記録されています</p>
            </>
          )}
        </section>
      )}

      {found.length > 0 && (
        <button class="btn ghost block" style={{ marginTop: 16 }} disabled={sending} onClick={() => go('/')}>
          完了
        </button>
      )}
    </>
  );
}
