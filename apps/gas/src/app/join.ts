/** 参加リンク（LINEを使わない人の出欠）。合言葉が合う練習への出欠登録だけができる */
import { goingList, perPersonFee, roomInfo, toJstDate, type Answer, type JoinActions, type JoinView, type Practice } from '@pb/shared';
import { UserError, type Ctx } from './ports';
import { recordAnswer } from './practices';

function openPractice(ctx: Ctx, id: unknown, key: unknown): Practice {
  const p = typeof id === 'string' ? ctx.store.getPractice(id) : null;
  if (!p || typeof key !== 'string' || !key || p.joinKey !== key) throw new UserError('参加リンクが無効です');
  if (p.status === '終了' || p.date < toJstDate(ctx.now())) throw new UserError('この練習は終了しました');
  return p;
}

function joinView(ctx: Ctx, p: Practice, participant?: string): JoinView {
  const att = ctx.store.attendance(p.id);
  const going = goingList(att, p.id).length;
  const settings = ctx.store.settings();
  const mine = participant ? att.find((a) => a.participant === participant && a.via === '参加リンク') : undefined;
  return {
    id: p.id,
    date: p.date,
    start: p.start,
    end: p.end,
    studio: p.studio,
    room: p.room,
    roomInfo: roomInfo(settings.studios, p.studio, p.room),
    memo: p.memo,
    status: p.status,
    goingCount: going,
    perPerson: perPersonFee(p.fee, going, settings.roundUnit, p.feeOverride),
    myAnswer: mine?.answer ?? null,
  };
}

export function handleJoin(ctx: Ctx, action: string, params: Record<string, unknown>): unknown {
  if (action === 'get') {
    const { id, key, participant } = params as JoinActions['get']['params'];
    return joinView(ctx, openPractice(ctx, id, key), participant);
  }
  if (action === 'answer') {
    const { id, key, name, answer, participant } = params as JoinActions['answer']['params'];
    const p = openPractice(ctx, id, key);
    if (answer !== '行く' && answer !== '行かない') throw new UserError('回答が不正です');
    const n = typeof name === 'string' ? name.trim().slice(0, 30) : '';
    if (!n) throw new UserError('名前を入力してください');
    // 同じ端末からの回答し直しは、前回の登録を更新する
    const prev =
      typeof participant === 'string' && participant.startsWith('guest:')
        ? ctx.store.attendance(p.id).find((a) => a.participant === participant && a.via === '参加リンク')
        : undefined;
    const pid = prev?.participant ?? `guest:${ctx.uuid()}`;
    const res = recordAnswer(ctx, p.id, { participant: pid, name: n, kind: 'ゲスト', via: '参加リンク', addedBy: '' }, answer as Answer);
    if (!res.ok) throw new UserError(res.reason);
    return { ...joinView(ctx, p, pid), participant: pid };
  }
  throw new UserError('不明な操作です');
}
