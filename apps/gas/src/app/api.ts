import {
  canEditPractice,
  canRegister,
  canRemoveAttendance,
  cancelText,
  classifyReservations,
  googleCalendarUrl,
  isActive,
  isAdmin,
  minutes,
  normalizeTime,
  perPersonFee,
  sortPractices,
  toJstDate,
  appLink,
  type ApiAction,
  type ApiActions,
  type Attendance,
  type AttendeeView,
  type Member,
  type Practice,
  type PracticeView,
  type Role,
  type Settings,
} from '@pb/shared';
import { UserError, type Ctx } from './ports';
import { buildDraft, createPractices, ensureMember, loadDraft, recordAnswer, refreshStatus, removeDraft } from './practices';

type Handler<A extends ApiAction> = (ctx: Ctx, me: Member, params: ApiActions[A]['params']) => ApiActions[A]['result'];

/** LINE内アプリからの呼び出し。userId はIDトークンの検証で得たもの */
export function handleApi(ctx: Ctx, auth: { userId: string; name?: string }, action: string, params: unknown): unknown {
  const handler = (handlers as Record<string, Handler<ApiAction>>)[action];
  if (!handler) throw new UserError(`不明な操作です: ${action}`);
  const me = ctx.withLock(() => ensureMember(ctx, auth.userId, { name: auth.name }));
  return handler(ctx, me, (params ?? {}) as never);
}

// ---------------------------------------------------------------- 表示用データ

export function practiceView(ctx: Ctx, p: Practice, me: Member | null, att?: Attendance[], members?: Member[], settings?: Settings): PracticeView {
  att ??= ctx.store.attendance(p.id);
  members ??= ctx.store.members();
  settings ??= ctx.store.settings();
  const byId = new Map(members.map((m) => [m.userId, m]));
  const mine = att.filter((a) => a.practiceId === p.id);
  const toView = (a: Attendance): AttendeeView => ({
    participant: a.participant,
    name: a.kind === 'メンバー' ? (byId.get(a.participant)?.name ?? a.name) : a.name,
    kind: a.kind,
    via: a.via,
    answer: a.answer,
    addedByName: a.kind === 'ゲスト' && a.addedBy ? (byId.get(a.addedBy)?.name ?? null) : null,
    canRemove: canRemoveAttendance(me, p, a),
  });
  const going = mine.filter((a) => a.answer === '行く').map(toView);
  const notGoing = mine.filter((a) => a.answer === '行かない').map(toView);
  const canEdit = canEditPractice(me, p);
  const { joinKey, ...rest } = p;
  const detailUrl = appLink(ctx.config.appUrl, { p: p.id });
  return {
    practice: rest,
    bookerName: byId.get(p.booker)?.name ?? '（不明）',
    groupNames: p.groups.map((g) => settings!.groups.find((x) => x.id === g)?.name ?? '（退出したグループ）'),
    going,
    notGoing,
    goingCount: going.length,
    perPerson: perPersonFee(p.fee, going.length, settings.roundUnit, p.feeOverride),
    myAnswer: me ? (mine.find((a) => a.participant === me.userId)?.answer ?? null) : null,
    canEdit,
    joinUrl: me && isActive(p) ? appLink(ctx.config.joinPageUrl, { p: p.id, k: joinKey }) : null,
    icsUrl: appLink(ctx.config.gasUrl, { action: 'ics', id: p.id }),
    googleCalendarUrl: googleCalendarUrl(p, detailUrl),
  };
}

function getPracticeOrThrow(ctx: Ctx, id: string): Practice {
  const p = ctx.store.getPractice(id);
  if (!p) throw new UserError('練習が見つかりません');
  return p;
}

function view(ctx: Ctx, id: string, me: Member): PracticeView {
  return practiceView(ctx, getPracticeOrThrow(ctx, id), me);
}

const requireAdmin = (me: Member) => {
  if (!isAdmin(me)) throw new UserError('管理者だけが操作できます');
};

const requireEditable = (me: Member, p: Practice) => {
  if (!canEditPractice(me, p)) throw new UserError('この練習の予約者か管理者だけが操作できます');
};

const cleanName = (s: unknown, max = 30) => {
  const name = typeof s === 'string' ? s.trim().slice(0, max) : '';
  if (!name) throw new UserError('名前を入力してください');
  return name;
};

// ---------------------------------------------------------------- 各操作

const handlers: { [A in ApiAction]: Handler<A> } = {
  me(ctx, me) {
    const s = ctx.store.settings();
    return { member: me, groups: s.groups, settings: s };
  },

  listPractices(ctx, me) {
    const today = toJstDate(ctx.now());
    const att = ctx.store.attendance();
    const members = ctx.store.members();
    const settings = ctx.store.settings();
    return sortPractices(ctx.store.practices().filter((p) => p.date >= today && p.status !== '終了')).map((p) =>
      practiceView(ctx, p, me, att, members, settings),
    );
  },

  getPractice(ctx, me, { id }) {
    return view(ctx, id, me);
  },

  rsvp(ctx, me, { id, answer }) {
    if (answer !== '行く' && answer !== '行かない') throw new UserError('回答が不正です');
    const res = recordAnswer(ctx, id, { participant: me.userId, name: me.name, kind: 'メンバー', via: 'アプリ', addedBy: me.userId }, answer);
    if (!res.ok) throw new UserError(res.reason);
    return view(ctx, id, me);
  },

  addGuest(ctx, me, { id, name }) {
    const res = recordAnswer(
      ctx,
      id,
      { participant: `guest:${ctx.uuid()}`, name: cleanName(name), kind: 'ゲスト', via: 'アプリ', addedBy: me.userId },
      '行く',
    );
    if (!res.ok) throw new UserError(res.reason);
    return view(ctx, id, me);
  },

  removeAttendance(ctx, me, { id, participant }) {
    ctx.withLock(() => {
      const p = getPracticeOrThrow(ctx, id);
      const a = ctx.store.attendance(id).find((x) => x.participant === participant);
      if (!a) return;
      if (!canRemoveAttendance(me, p, a)) throw new UserError('この出欠は取り消せません');
      ctx.store.deleteAttendance(id, participant);
      refreshStatus(ctx, p);
    });
    return view(ctx, id, me);
  },

  appendMemo(ctx, me, { id, text }) {
    const t = typeof text === 'string' ? text.trim().slice(0, 300) : '';
    if (!t) throw new UserError('メモを入力してください');
    ctx.withLock(() => {
      const p = getPracticeOrThrow(ctx, id);
      ctx.store.savePractice({ ...p, memo: [p.memo, `${t}（${me.name}）`].filter(Boolean).join('\n') });
    });
    return view(ctx, id, me);
  },

  parseScreenshot(ctx, me, { images }) {
    if (!canRegister(me)) throw new UserError('予約者として登録されていません');
    if (!Array.isArray(images) || images.length === 0) throw new UserError('画像を選んでください');
    if (images.length > 5) throw new UserError('画像は5枚までにしてください');
    const raws = ctx.reader.read(images, toJstDate(ctx.now()));
    const d = buildDraft(ctx, me, raws);
    return { items: d.items, incomplete: d.incomplete };
  },

  getDraft(ctx, me, { id }) {
    const d = loadDraft(ctx, id);
    if (!d || d.booker !== me.userId) return null;
    // 確認カードを出してから状態が変わっているかもしれないので分類し直す
    return { ...d, items: classifyReservations(ctx.store.practices(), d.items.map((i) => i.reservation)) };
  },

  classify(ctx, _me, { reservations }) {
    return classifyReservations(ctx.store.practices(), reservations ?? []);
  },

  createPractices(ctx, me, { items, groups, draftId }) {
    const result = createPractices(ctx, me, items ?? [], groups ?? []);
    if (draftId) removeDraft(ctx, draftId);
    return result;
  },

  updatePractice(ctx, me, { id, patch }) {
    ctx.withLock(() => {
      const p = getPracticeOrThrow(ctx, id);
      requireEditable(me, p);
      const next: Practice = { ...p };
      if (patch.start !== undefined) next.start = normalizeTime(patch.start) ?? fail('開始時刻が不正です');
      if (patch.end !== undefined) next.end = normalizeTime(patch.end) ?? fail('終了時刻が不正です');
      if (minutes(next.end) <= minutes(next.start)) fail('終了時刻は開始時刻より後にしてください');
      if (patch.room !== undefined) next.room = String(patch.room).trim();
      if (patch.fee !== undefined) next.fee = nonNegative(patch.fee) ?? fail('料金が不正です');
      if (patch.max !== undefined) next.max = positiveOrNull(patch.max);
      if (patch.min !== undefined) next.min = positiveOrNull(patch.min);
      if (patch.feeOverride !== undefined) next.feeOverride = positiveOrNull(patch.feeOverride);
      if (patch.memo !== undefined) next.memo = String(patch.memo).slice(0, 1000);
      ctx.store.savePractice(next);
      refreshStatus(ctx, next);
    });
    return view(ctx, id, me);
  },

  cancelPractice(ctx, me, { id }) {
    let cancelled: Practice | null = null;
    ctx.withLock(() => {
      const p = getPracticeOrThrow(ctx, id);
      requireEditable(me, p);
      if (p.status === '中止') return;
      cancelled = { ...p, status: '中止' };
      ctx.store.savePractice(cancelled);
    });
    if (cancelled) {
      const p: Practice = cancelled;
      for (const g of p.groups) {
        try {
          ctx.line.push(g, [{ type: 'text', text: cancelText(p) }]);
        } catch (e) {
          ctx.log('cancel push failed', g, e);
        }
      }
    }
    return view(ctx, id, me);
  },

  setDisplayName(ctx, me, { name }) {
    const m = { ...me, name: cleanName(name, 20) };
    ctx.withLock(() => ctx.store.saveMember(m));
    return m;
  },

  listMembers(ctx, me) {
    requireAdmin(me);
    return ctx.store.members();
  },

  updateMember(ctx, me, { userId, patch }) {
    requireAdmin(me);
    return ctx.withLock(() => {
      const m = ctx.store.getMember(userId);
      if (!m) throw new UserError('メンバーが見つかりません');
      const next: Member = { ...m };
      if (patch.name !== undefined) next.name = cleanName(patch.name, 20);
      if (patch.role !== undefined) {
        if (!(['管理者', '予約者', '一般'] as Role[]).includes(patch.role)) throw new UserError('権限が不正です');
        const admins = ctx.store.members().filter((x) => x.role === '管理者');
        if (m.role === '管理者' && patch.role !== '管理者' && admins.length <= 1) throw new UserError('管理者が1人もいなくなります');
        next.role = patch.role;
      }
      if (patch.defaultGroups !== undefined) {
        const ids = new Set(ctx.store.settings().groups.map((g) => g.id));
        next.defaultGroups = patch.defaultGroups.filter((g) => ids.has(g));
      }
      ctx.store.saveMember(next);
      return next;
    });
  },

  renameGroup(ctx, me, { id, name }) {
    requireAdmin(me);
    return ctx.withLock(() => {
      const s = ctx.store.settings();
      const g = s.groups.find((x) => x.id === id);
      if (!g) throw new UserError('グループが見つかりません');
      g.name = cleanName(name);
      ctx.store.saveSettings(s);
      return s.groups;
    });
  },

  updateSettings(ctx, me, params) {
    requireAdmin(me);
    return ctx.withLock(() => {
      const s = ctx.store.settings();
      const next: Settings = {
        ...s,
        fees: (params.fees ?? [])
          .filter((f) => f.studio?.trim())
          .map((f) => ({ studio: f.studio.trim(), room: (f.room ?? '').trim(), fee: nonNegative(f.fee) ?? 0 })),
        cancelRules: (params.cancelRules ?? [])
          .filter((r) => r.studio?.trim())
          .map((r) => ({
            studio: r.studio.trim(),
            daysBefore: nonNegative(r.daysBefore) ?? 1,
            time: normalizeTime(r.time) ?? '10:00',
          })),
        minDefault: positiveOrNull(params.minDefault) ?? s.minDefault,
        roundUnit: positiveOrNull(params.roundUnit) ?? s.roundUnit,
      };
      ctx.store.saveSettings(next);
      return next;
    });
  },
};

function fail(msg: string): never {
  throw new UserError(msg);
}

function toNumber(n: unknown): number {
  return typeof n === 'string' && n.trim() !== '' ? Number(n) : typeof n === 'number' ? n : NaN;
}

function nonNegative(n: unknown): number | null {
  const v = toNumber(n);
  return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
}

function positiveOrNull(n: unknown): number | null {
  const v = toNumber(n);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}
