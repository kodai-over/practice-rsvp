import { cancelWarningAt, findCancelRule, goingList, isActive, toJstDate, warningText } from '@studio-attendance/shared';
import type { Ctx } from './ports';

/**
 * 毎時実行。
 * - 日付を過ぎた練習を「終了」にする（参加リンクも無効になる）
 * - キャンセル期限前警告：警告時刻を過ぎ、参加人数が最低人数に届いていない練習を予約者に知らせる
 * - グループ名をLINE側の名前にそろえる
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

  // 名前の同期が失敗しても、終了処理と警告は済ませておく
  try {
    syncGroupNames(ctx);
  } catch (e) {
    ctx.log('group name sync failed', e);
  }
}

/** 名前を取得できない（Botが入っていない）ことがこの回数続いたら、設定から外す */
const GONE_LIMIT = 3;
const goneKey = (id: string) => `groupgone:${id}`;

/**
 * グループ名をLINE側の名前にそろえる（グループ名の変更はWebhookで届かないため、毎時取得し直す）。
 * あわせて、Botが入っていないグループ（招待直後に外れて退出の知らせが届かなかったものなど）を設定から外す。
 * 外すのは「見つからない」が GONE_LIMIT 回続いたときだけで、通信エラーなど一時的な失敗では外さない。
 * 複数人トーク（IDが C で始まらない）は名前を取得できないので対象外
 */
export function syncGroupNames(ctx: Ctx): void {
  const latest = new Map<string, string>();
  const gone = new Set<string>();
  for (const g of ctx.store.settings().groups) {
    if (!g.id.startsWith('C')) continue;
    let summary;
    try {
      summary = ctx.line.groupSummary(g.id);
    } catch (e) {
      ctx.log('group summary error', g.id, e);
      continue;
    }
    if (summary) {
      ctx.kv.remove(goneKey(g.id));
      // 設定シートは読み込み時に前後の空白を除くので、そろえておかないと毎回「変わった」とみなしてしまう
      const name = summary.groupName?.trim().slice(0, 50);
      if (name) latest.set(g.id, name);
      continue;
    }
    const count = Number(ctx.kv.get(goneKey(g.id)) ?? '0') + 1;
    ctx.log('group summary not found', g.id, count);
    if (count >= GONE_LIMIT) gone.add(g.id);
    else ctx.kv.put(goneKey(g.id), String(count), 6 * 60 * 60);
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
    const kept = s.groups.filter((g) => !gone.has(g.id));
    if (kept.length !== s.groups.length) {
      s.groups = kept;
      changed = true;
    }
    if (changed) ctx.store.saveSettings(s);
  });
  for (const id of gone) {
    ctx.kv.remove(goneKey(id));
    ctx.log('group removed (bot not in group)', id);
  }
}
