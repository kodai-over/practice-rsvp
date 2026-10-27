import {
  canRegister,
  canonicalizeStudio,
  classifyReservations,
  defaultFee,
  goingList,
  isActive,
  nextStatus,
  normalizeReservation,
  recruitMessages,
  roomInfo,
  sortPractices,
  toJstDate,
  toJstTime,
  type Answer,
  type AttendeeKind,
  type CreateResult,
  type Draft,
  type Member,
  type NewPracticeInput,
  type Practice,
  type Reservation,
  type Settings,
  type Via,
  makePracticeId,
} from '@studio-attendance/shared';
import { UserError, type Ctx, type RawReservation, type ReaderInput } from './ports';

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

/** スクショか文章から予約を読み取る。スタジオ・部屋の一覧を手がかりとして渡す */
export function readReservations(ctx: Ctx, input: ReaderInput): RawReservation[] {
  const settings = ctx.store.settings();
  const known = new Set(settings.studios.map((s) => s.name));
  const others = [...new Set(ctx.store.practices().map((p) => p.studio))].filter((n) => n && !known.has(n));
  const studios = [...settings.studios, ...others.map((name) => ({ name, aliases: [], rooms: [] }))];
  return ctx.reader.read(input, { today: toJstDate(ctx.now()), studios });
}

/**
 * 読み取った予約から下書きを作る。
 * 対象外の予約（今日より前・今日すでに終わった時間帯・登録済み）は除いて件数だけ数える。
 * 同じ部屋で続く予約は1件にまとめ（classifyReservations）、料金が読めなければ標準料金を入れる。
 */
export function buildDraft(ctx: Ctx, booker: Member, raws: RawReservation[]): Draft {
  const settings = ctx.store.settings();
  const today = toJstDate(ctx.now());
  const nowTime = toJstTime(ctx.now());
  const isPast = (r: Partial<Reservation>) => !!r.date && (r.date < today || (r.date === today && !!r.end && r.end <= nowTime));
  const complete: Reservation[] = [];
  const incomplete: Partial<Reservation>[] = [];
  let pastCount = 0;
  for (const raw of raws) {
    const n = normalizeReservation(raw);
    // スタジオ名・部屋名を一覧の正式な名前にそろえる（「わーくる横浜」「横浜 301」→ studio worcle 横浜 301）
    const r = n && canonicalizeStudio(settings.studios, n);
    const partial = r ? null : pickPartial(raw);
    if (r ? isPast(r) : isPast(partial!)) pastCount++;
    else if (r) complete.push(r);
    else incomplete.push(canonicalizePartial(settings.studios, partial!));
  }
  // 続いている予約をまとめ、登録済みのものを除いてから、料金が読めなかったものに標準料金を入れる
  const classified = classifyReservations(ctx.store.practices(), complete);
  const items = classified.filter((i) => i.kind !== 'duplicate').map((i) => ({
    ...i,
    reservation: { ...i.reservation, fee: i.reservation.fee ?? (defaultFee(settings, i.reservation) || null) },
  }));
  return {
    id: ctx.uuid(),
    booker: booker.userId,
    items,
    incomplete,
    pastCount,
    duplicateCount: classified.length - items.length,
    groups: defaultGroupsFor(booker, settings.groups.map((g) => g.id)),
    createdAt: ctx.now().toISOString(),
  };
}

/** ふだんの送り先。未設定でグループが1つしかなければ、そのグループにする */
export function defaultGroupsFor(m: Member, groupIds: string[]): string[] {
  const mine = m.defaultGroups.filter((g) => groupIds.includes(g));
  if (mine.length > 0) return mine;
  return groupIds.length === 1 ? groupIds : [];
}

/** 読み取れなかった項目がある予約も、スタジオ名・部屋名だけは正式な名前にそろえる */
function canonicalizePartial(studios: Settings['studios'], p: Partial<Reservation>): Partial<Reservation> {
  if (!p.studio) return p;
  const c = canonicalizeStudio(studios, { date: '', start: '', end: '', fee: null, room: '', ...p, studio: p.studio });
  return { ...p, studio: c.studio, ...(p.room ? { room: c.room } : {}) };
}

function pickPartial(raw: RawReservation): Partial<Reservation> {
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
 * 練習を登録する。送り先グループを指定したときだけ、新しく登録した練習の募集をそのグループに流す。
 * 同じ練習IDは登録済みとして飛ばし、直後に続く予約は既存の練習の延長として更新する（募集は出さない）。
 */
export function createPractices(ctx: Ctx, booker: Member, inputs: NewPracticeInput[], groups: string[]): CreateResult {
  if (!canRegister(booker)) throw new UserError('練習を登録できません');
  const settings = ctx.store.settings();
  const validGroups = groups.filter((g) => settings.groups.some((s) => s.id === g));
  const result: CreateResult = { created: [], extended: [], skipped: [] };
  const created: Practice[] = [];

  const normalized = inputs.map((input) => {
    const r = normalizeReservation(input);
    if (!r) throw new UserError(`入力が足りない予約があります（${input.date || '日付なし'}）`);
    return { input, r: { ...r, fee: r.fee ?? defaultFee(settings, r) } };
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
      // 登録した人は自動で「行く」にする
      ctx.store.saveAttendance({
        practiceId: p.id,
        participant: booker.userId,
        name: booker.name,
        kind: 'メンバー',
        via: 'アプリ',
        addedBy: booker.userId,
        answer: '行く',
        updatedAt: ctx.now().toISOString(),
      });
      result.created.push(p.id);
    }
  });

  if (created.length > 0) result.recruited = sendRecruit(ctx, sortPractices(created), validGroups, booker.name);
  return result;
}

/** 練習の募集をグループに流す（1グループにつき1メッセージ）。送れたグループを返す */
export function sendRecruit(ctx: Ctx, practices: Practice[], groups: string[], bookerName: string): string[] {
  if (practices.length === 0 || groups.length === 0) return [];
  const { studios } = ctx.store.settings();
  const messages = recruitMessages(
    practices.map((practice) => ({ practice, bookerName, roomInfo: roomInfo(studios, practice.studio, practice.room) })),
    ctx.config.appUrl,
  );
  const sent: string[] = [];
  for (const g of groups) {
    try {
      ctx.line.push(g, messages.slice(0, 5));
      sent.push(g);
    } catch (e) {
      ctx.log('recruit push failed', g, e);
    }
  }
  return sent;
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
