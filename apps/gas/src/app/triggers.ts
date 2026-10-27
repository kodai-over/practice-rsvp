import { cancelWarningAt, findCancelRule, goingList, isActive, toJstDate, warningText } from '@studio-attendance/shared';
import type { Ctx } from './ports';

/**
 * 毎時実行。
 * - グループ名をLINE側の名前にそろえる
 * - 日付を過ぎた練習を「終了」にする（参加リンクも無効になる）
 * - キャンセル期限前警告：警告時刻を過ぎ、参加人数が最低人数に届いていない練習を予約者に知らせる
 */
export function hourlyJob(ctx: Ctx): void {
  syncGroupNames(ctx);
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

/**
 * グループ名をLINE側の名前にそろえる（グループ名の変更はWebhookで届かないため、毎時取得し直す）。
 * 複数人トーク（IDが C で始まらない）は名前を取得できないので対象外。取得に失敗したグループはそのままにする
 */
export function syncGroupNames(ctx: Ctx): void {
  const latest = new Map<string, string>();
  for (const g of ctx.store.settings().groups) {
    if (!g.id.startsWith('C')) continue;
    try {
      const name = ctx.line.groupSummary(g.id)?.groupName;
      if (name) latest.set(g.id, name);
    } catch (e) {
      ctx.log('group summary error', g.id, e);
    }
  }
  ctx.withLock(() => {
    const s = ctx.store.settings();
    let changed = false;
    for (const g of s.groups) {
      const name = latest.get(g.id);
      if (name && name !== g.name) {
        g.name = name;
        changed = true;
      }
    }
    if (changed) ctx.store.saveSettings(s);
  });
}
