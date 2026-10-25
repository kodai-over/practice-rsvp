import {
  canRegister,
  classifyReservations,
  defaultFee,
  goingList,
  isActive,
  nextStatus,
  normalizeReservation,
  recruitMessages,
  sortPractices,
  toJstDate,
  type Answer,
  type AttendeeKind,
  type CreateResult,
  type Draft,
  type Member,
  type NewPracticeInput,
  type Practice,
  type Reservation,
  type Via,
  makePracticeId,
} from '@pb/shared';
import { UserError, type Ctx } from './ports';

// ---------------------------------------------------------------- メンバー

export function memberName(ctx: Ctx, userId: string): string {
  return ctx.store.getMember(userId)?.name ?? '（不明）';
}

/** 未登録のLINEユーザーを一般メンバーとして登録する。名前はLINEのプロフィールから */
export function ensureMember(ctx: Ctx, userId: string, opts: { groupId?: string; name?: string } = {}): Member {
  const found = ctx.store.getMember(userId);
  if (found) return found;
  let name = opts.name ?? '';
  if (!name) {
    try {
      const prof = opts.groupId ? ctx.line.groupMemberProfile(opts.groupId, userId) : ctx.line.profile(userId);
      name = prof?.displayName ?? '';
    } catch (e) {
      ctx.log('profile error', e);
    }
  }
  const m: Member = { userId, name: name || 'メンバー', role: '一般', defaultGroups: [] };
  ctx.store.saveMember(m);
  return m;
}

// ---------------------------------------------------------------- 下書き（確認カード）

const DRAFT_TTL = 6 * 60 * 60;

export function buildDraft(ctx: Ctx, booker: Member, raws: Partial<Record<keyof Reservation, unknown>>[]): Draft {
  const settings = ctx.store.settings();
  const complete: Reservation[] = [];
  const incomplete: Partial<Reservation>[] = [];
  for (const raw of raws) {
    const r = normalizeReservation(raw);
    if (r) complete.push({ ...r, fee: r.fee ?? (defaultFee(settings, r.studio, r.room) || null) });
    else incomplete.push(pickPartial(raw));
  }
  const groupIds = new Set(settings.groups.map((g) => g.id));
  return {
    id: ctx.uuid(),
    booker: booker.userId,
    items: classifyReservations(ctx.store.practices(), complete),
    incomplete,
    groups: booker.defaultGroups.filter((g) => groupIds.has(g)),
    createdAt: ctx.now().toISOString(),
  };
}

function pickPartial(raw: Partial<Record<keyof Reservation, unknown>>): Partial<Reservation> {
  const out: Partial<Reservation> = {};
  for (const k of ['date', 'start', 'end', 'studio', 'room'] as const) {
    if (typeof raw[k] === 'string' && raw[k]) out[k] = raw[k] as string;
  }
  if (typeof raw.fee === 'number') out.fee = raw.fee;
  return out;
}

export function saveDraft(ctx: Ctx, d: Draft): void {
  ctx.kv.put(`draft:${d.id}`, JSON.stringify(d), DRAFT_TTL);
}

export function loadDraft(ctx: Ctx, id: string): Draft | null {
  const s = ctx.kv.get(`draft:${id}`);
  return s ? (JSON.parse(s) as Draft) : null;
}

export function removeDraft(ctx: Ctx, id: string): void {
  ctx.kv.remove(`draft:${id}`);
}

// ---------------------------------------------------------------- 登録と募集

/**
 * 練習を登録し、新しく登録した練習の募集を送り先グループに流す。
 * 同じ練習IDは登録済みとして飛ばし、直後に続く予約は既存の練習の延長として更新する（募集は出さない）。
 */
export function createPractices(ctx: Ctx, booker: Member, inputs: NewPracticeInput[], groups: string[]): CreateResult {
  if (!canRegister(booker)) throw new UserError('予約者として登録されていません');
  const settings = ctx.store.settings();
  const validGroups = groups.filter((g) => settings.groups.some((s) => s.id === g));
  const result: CreateResult = { created: [], extended: [], skipped: [] };
  const created: Practice[] = [];

  const normalized = inputs.map((input) => {
    const r = normalizeReservation(input);
    if (!r) throw new UserError(`入力が足りない予約があります（${input.date || '日付なし'}）`);
    return { input, r: { ...r, fee: r.fee ?? defaultFee(settings, r.studio, r.room) } };
  });

  ctx.withLock(() => {
    const practices = ctx.store.practices();
    // 先に全件を分類し、送り先がないまま一部だけ登録されることを防ぐ
    const plan = normalized.map(({ input, r }) => {
      const [item] = classifyReservations(practices, [r]);
      if (item.kind === 'new') {
        // 同じ登録内で続く予約（19-21時と21-22時など）も延長として扱えるよう、仮に積んでおく
        practices.push({ ...draftPractice(ctx, booker, r, input, validGroups) });
      }
      return { input, r, item };
    });
    if (plan.some((x) => x.item.kind === 'new') && validGroups.length === 0) {
      throw new UserError('送り先グループを選んでください');
    }
    for (const { r, item } of plan) {
      if (item.kind === 'duplicate') {
        result.skipped.push(item.targetId!);
      } else if (item.kind === 'extension') {
        const target = practices.find((p) => p.id === item.targetId)!;
        target.end = r.end;
        target.fee += r.fee;
        if (!created.includes(target)) {
          ctx.store.savePractice(target);
          result.extended.push(target.id);
        }
      } else {
        created.push(practices.find((p) => p.id === makePracticeId(r))!);
      }
    }
    for (const p of created) {
      ctx.store.savePractice(p, booker.name);
      result.created.push(p.id);
    }
  });

  if (created.length > 0) {
    const messages = recruitMessages(
      sortPractices(created).map((practice) => ({ practice, bookerName: booker.name })),
      ctx.config.appUrl,
    );
    for (const g of validGroups) {
      try {
        ctx.line.push(g, messages.slice(0, 5));
      } catch (e) {
        ctx.log('recruit push failed', g, e);
      }
    }
  }
  return result;
}

function draftPractice(ctx: Ctx, booker: Member, r: Reservation & { fee: number }, input: NewPracticeInput, groups: string[]): Practice {
  return {
    id: makePracticeId(r),
    date: r.date,
    start: r.start,
    end: r.end,
    studio: r.studio,
    room: r.room,
    fee: r.fee,
    booker: booker.userId,
    max: positiveOrNull(input.max),
    min: positiveOrNull(input.min),
    memo: (input.memo ?? '').trim(),
    status: '募集中',
    groups,
    joinKey: ctx.uuid(),
    feeOverride: null,
    warned: false,
    createdAt: ctx.now().toISOString(),
  };
}

const positiveOrNull = (n: unknown): number | null => {
  const v = typeof n === 'string' ? Number(n) : n;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
};

export function upcoming(ctx: Ctx, groupId?: string): Practice[] {
  const today = toJstDate(ctx.now());
  return sortPractices(
    ctx.store.practices().filter((p) => isActive(p) && p.date >= today && (!groupId || p.groups.includes(groupId))),
  );
}

// ---------------------------------------------------------------- 出欠

export interface Respondent {
  participant: string;
  name: string;
  kind: AttendeeKind;
  via: Via;
  addedBy: string;
}

/** 出欠を記録する。受け付けられないときは理由を返す */
export function recordAnswer(ctx: Ctx, practiceId: string, who: Respondent, answer: Answer): { ok: true } | { ok: false; reason: string } {
  return ctx.withLock(() => {
    const p = ctx.store.getPractice(practiceId);
    if (!p) return { ok: false as const, reason: '練習が見つかりません' };
    if (p.status === '中止') return { ok: false as const, reason: '中止になりました' };
    if (p.status === '終了' || p.date < toJstDate(ctx.now())) return { ok: false as const, reason: 'この練習は終了しました' };
    const att = ctx.store.attendance(p.id);
    const existing = att.find((a) => a.participant === who.participant);
    const going = goingList(att, p.id).length;
    if (answer === '行く' && existing?.answer !== '行く' && p.max != null && p.max > 0 && going >= p.max) {
      return { ok: false as const, reason: '満員です' };
    }
    ctx.store.saveAttendance({
      practiceId: p.id,
      participant: who.participant,
      name: who.name,
      kind: who.kind,
      via: existing?.via ?? who.via,
      addedBy: existing?.addedBy ?? who.addedBy,
      answer,
      updatedAt: ctx.now().toISOString(),
    });
    refreshStatus(ctx, p);
    return { ok: true as const };
  });
}

export function refreshStatus(ctx: Ctx, p: Practice): void {
  const going = goingList(ctx.store.attendance(p.id), p.id).length;
  const status = nextStatus(p, going);
  if (status !== p.status) ctx.store.savePractice({ ...p, status });
}
