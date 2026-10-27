import { cancelWarningAt, findCancelRule, goingList, isActive, toJstDate, warningText } from '@studio-attendance/shared';
import type { Ctx } from './ports';

/**
 * 毎時実行。
 * - 日付を過ぎた練習を「終了」にする（参加リンクも無効になる）
 * - キャンセル期限前警告：警告時刻を過ぎ、参加人数が最低人数に届いていない練習を予約者に知らせる
 */
export function hourlyJob(ctx: Ctx): void {
  const now = ctx.now();
  const today = toJstDate(now);
  const settings = ctx.store.settings();
  const att = ctx.store.attendance();
  const warnings: { to: string; text: string }[] = [];

  ctx.withLock(() => {
    for (const p of ctx.store.practices()) {
      if (!isActive(p)) continue;
      if (p.date < today) {
        ctx.store.savePractice({ ...p, status: '終了' });
        continue;
      }
      if (p.warned) continue;
      const rule = findCancelRule(settings.cancelRules, p.studio);
      if (!rule) continue;
      const warnAt = cancelWarningAt(p.date, rule);
      if (now < warnAt) continue;
      ctx.store.savePractice({ ...p, warned: true });
      // 警告時刻を過ぎてから入った予約には出さない
      if (new Date(p.createdAt) >= warnAt) continue;
      const going = goingList(att, p.id).length;
      const min = p.min ?? settings.minDefault;
      if (going < min) warnings.push({ to: p.booker, text: warningText(p, going, min, ctx.config.appUrl) });
    }
  });

  for (const w of warnings) {
    try {
      ctx.line.push(w.to, [{ type: 'text', text: w.text }]);
    } catch (e) {
      ctx.log('warning push failed', w.to, e);
    }
  }
}
