import { answerReport } from '@studio-attendance/shared';
import { canSendToChat, closeApp, sendToChat } from '../liff';
import { Icon, Spinner, Syncing, TopBar, useApp, useRunner } from '../ui';
import { PracticeCard, useAnswer } from './List';

/** 募集カードの「出欠を答える」から開く画面。その募集の練習だけを並べ、答えたらグループに伝えられる */
export function AnswerPage({ ids }: { ids: string[] }) {
  const { practices: list, practicesAt, toast } = useApp();
  const [run, busy] = useRunner();
  const answer = useAnswer(run);
  const [send, sending] = useRunner();

  const found = ids.map((id) => list?.find((v) => v.practice.id === id)).filter((v) => v != null);
  // 前回の表示に無い練習は、最新を取り終わるまで待つ（募集されたばかりの練習は前回の表示に無い）
  if (list == null || (found.length < ids.length && practicesAt === 0))
    return (
      <>
        <TopBar title="出欠を答える" />
        <Spinner />
      </>
    );

  const report = answerReport(found.map((v) => ({ practice: v.practice, answer: v.myAnswer })));
  const inChat = canSendToChat();
  const tell = () =>
    send(async () => {
      try {
        await sendToChat(report!);
      } catch {
        throw new Error('グループに送れませんでした。回答は記録されています');
      }
      toast('グループに伝えました');
      // トークに戻ると、送った発言がそのまま見える
      closeApp();
    });

  return (
    <>
      <TopBar title="出欠を答える">{busy && <Syncing />}</TopBar>
      {found.length === 0 ? (
        <div class="empty">練習が見つかりません（削除されたか、見られない練習です）</div>
      ) : (
        found.map((v) => <PracticeCard key={v.practice.id} v={v} onAnswer={(a) => answer(v.practice.id, a)} />)
      )}
      {found.length > 0 && found.length < ids.length && <p class="note">削除された練習は表示していません</p>}

      {found.length > 0 && (
        <section>
          <div class="sec-head">
            <Icon name="chat" size={18} />
            グループに伝える
          </div>
          {!inChat ? (
            <p class="note">回答は記録されています。グループのトークのカードから開くと、回答したことをグループに伝えられます</p>
          ) : (
            <>
              {report ? <pre class="report">{report}</pre> : <p class="note">○ か ✕ を選ぶと伝えられます（△は伝えません）</p>}
              <button class="btn primary block" disabled={!report || busy || sending} onClick={tell}>
                <Icon name="send" size={18} />
                グループに伝える
              </button>
              <p class="note">あなたの発言として、このトークに1回だけ送ります。送らなくても回答は記録されています</p>
            </>
          )}
        </section>
      )}
    </>
  );
}
