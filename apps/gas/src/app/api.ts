import {
  FEEDBACK_STATUSES,
  canDeleteFeedback,
  canEditPractice,
  canRegister,
  canRemoveAttendance,
  canSeePractice,
  classifyReservations,
  googleCalendarUrl,
  isActive,
  isAdmin,
  isAnswer,
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
  type Feedback,
  type FeedbackView,
  type Member,
  type Practice,
  type PracticeView,
  type Role,
  type Settings,
  type StudioDef,
} from '@studio-attendance/shared';
import { UserError, type Ctx, type RawReservation } from './ports';
import { buildDraft, createPractices, ensureMember, inGroupKey, loadDraft, noteGroupMember, readReservations, recordAnswer, refreshStatus, removeDraft, sendRecruit } from './practices';

type Handler<A extends ApiAction> = (ctx: Ctx, me: Member, params: ApiActions[A]['params']) => ApiActions[A]['result'];

/** LINE内アプリからの呼び出し。userId はIDトークンの検証で得たもの */
export function handleApi(ctx: Ctx, auth: { userId: string; name?: string }, action: string, params: unknown): unknown {
  const handler = (handlers as Record<string, Handler<ApiAction>>)[action];
  if (!handler) throw new UserError(`不明な操作です: ${action}`);
  // 登録済みならロックを取らない（起動を速くするため）。未登録のときだけロックして登録する
  const me = ctx.store.getMember(auth.userId) ?? ctx.withLock(() => ensureMember(ctx, auth.userId, { name: auth.name }));
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
  const maybe = mine.filter((a) => a.answer === '保留').map(toView);
  const notGoing = mine.filter((a) => a.answer === '行かない').map(toView);
  const canEdit = canEditPractice(me, p);
  const { joinKey, ...rest } = p;
  const detailUrl = appLink(ctx.config.appUrl, { p: p.id });
  return {
    practice: rest,
    bookerName: byId.get(p.booker)?.name ?? '（不明）',
    groupNames: p.groups.map((g) => settings!.groups.find((x) => x.id === g)?.name ?? '（退出したグループ）'),
    going,
    maybe,
    notGoing,
    goingCount: going.length,
    perPerson: perPersonFee(p.fee, going.length, settings.roundUnit, p.feeOverride),
    myAnswer: me ? (mine.find((a) => a.participant === me.userId)?.answer ?? null) : null,
    canEdit,
    joinUrl: me && isActive(p) ? appLink(ctx.config.joinPageUrl, { p: p.id, k: joinKey }) : null,
    icsUrl: appLink(ctx.config.gasUrl, { action: 'ics', id: p.id, k: joinKey }),
    googleCalendarUrl: googleCalendarUrl(p, detailUrl),
  };
}

/** 要望の一覧。新しい順。名前は今の表示名で出す。要望は送るだけで、一覧を見られるのは管理者だけ */
function feedbackList(ctx: Ctx, me: Member): FeedbackView[] {
  if (!isAdmin(me)) return [];
  const byId = new Map(ctx.store.members().map((m) => [m.userId, m]));
  return ctx.store
    .feedback()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((f: Feedback) => ({
      id: f.id,
      name: byId.get(f.userId)?.name ?? f.name,
      text: f.text,
      status: f.status,
      reply: f.reply,
      createdAt: f.createdAt,
      mine: f.userId === me.userId,
      canDelete: canDeleteFeedback(me, f),
    }));
}

const memberNameOf = (ctx: Ctx, userId: string) => ctx.store.getMember(userId)?.name ?? '（不明）';

function getPracticeOrThrow(ctx: Ctx, id: string): Practice {
  const p = ctx.store.getPractice(id);
  if (!p) throw new UserError('練習が見つかりません');
  return p;
}

/** 出欠に関わっている（本人が答えた・ゲストを足した）か */
const involved = (att: Attendance[], p: Practice, me: Member) =>
  att.some((a) => a.practiceId === p.id && (a.participant === me.userId || a.addedBy === me.userId));

const visibleTo = (ctx: Ctx, me: Member, p: Practice, att?: Attendance[]) => canSeePractice(me, p, involved(att ?? ctx.store.attendance(p.id), p, me));

/** 見えない練習は、無いものとして扱う */
function getVisibleOrThrow(ctx: Ctx, me: Member, id: string): Practice {
  const p = getPracticeOrThrow(ctx, id);
  if (!visibleTo(ctx, me, p)) throw new UserError('練習が見つかりません');
  return p;
}

function view(ctx: Ctx, id: string, me: Member): PracticeView {
  return practiceView(ctx, getVisibleOrThrow(ctx, me, id), me);
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

/** アプリに渡す設定。グループの合言葉は渡さない */
const publicSettings = (s: Settings): Settings => ({ ...s, groups: s.groups.map(({ id, name }) => ({ id, name })) });

// ---------------------------------------------------------------- 各操作

const handlers: { [A in ApiAction]: Handler<A> } = {
  me(ctx, me) {
    const pub = publicSettings(ctx.store.settings());
    return { member: me, groups: pub.groups, settings: pub };
  },

  home(ctx, me) {
    return { me: handlers.me(ctx, me, {}), practices: handlers.listPractices(ctx, me, {}) };
  },

  listPractices(ctx, me) {
    const today = toJstDate(ctx.now());
    const att = ctx.store.attendance();
    const members = ctx.store.members();
    const settings = ctx.store.settings();
    return sortPractices(ctx.store.practices().filter((p) => p.date >= today && p.status !== '終了' && visibleTo(ctx, me, p, att))).map((p) =>
      practiceView(ctx, p, me, att, members, settings),
    );
  },

  getPractice(ctx, me, { id }) {
    return view(ctx, id, me);
  },

  openedFromGroup(ctx, me, { group, key }) {
    const g = ctx.store.settings().groups.find((x) => x.id === group);
    // グループの合言葉はそのグループに送ったカードにしか出ないので、合っていればそのグループのカードから開いたとみなす
    if (g?.key && typeof key === 'string' && key === g.key) noteGroupMember(ctx, g.id, me.userId);
    return null;
  },

  rsvp(ctx, me, { id, answer }) {
    if (!isAnswer(answer)) throw new UserError('回答が不正です');
    getVisibleOrThrow(ctx, me, id);
    const res = recordAnswer(ctx, id, { participant: me.userId, name: me.name, kind: 'メンバー', via: 'アプリ', addedBy: me.userId }, answer);
    if (!res.ok) throw new UserError(res.reason);
    return view(ctx, id, me);
  },

  addGuest(ctx, me, { id, name }) {
    getVisibleOrThrow(ctx, me, id);
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
      const p = getVisibleOrThrow(ctx, me, id);
      const a = ctx.store.attendance(id).find((x) => x.participant === participant);
      if (!a) return;
      if (!canRemoveAttendance(me, p, a)) throw new UserError('この出欠は取り消せません');
      ctx.store.deleteAttendance(id, participant);
      refreshStatus(ctx, p);
    });
    // 自分の出欠を消して見えなくなっても、いま開いている画面には結果を返す
    return practiceView(ctx, getPracticeOrThrow(ctx, id), me);
  },

  appendMemo(ctx, me, { id, text }) {
    const t = typeof text === 'string' ? text.trim().slice(0, 300) : '';
    if (!t) throw new UserError('メモを入力してください');
    ctx.withLock(() => {
      const p = getVisibleOrThrow(ctx, me, id);
      ctx.store.savePractice({ ...p, memo: [p.memo, `${t}（${me.name}）`].filter(Boolean).join('\n') });
    });
    return view(ctx, id, me);
  },

  parseReservations(ctx, me, { images, text }) {
    if (!canRegister(me)) throw new UserError('練習を登録できません');
    const imgs = Array.isArray(images) ? images : [];
    const t = typeof text === 'string' ? text.trim().slice(0, 5000) : '';
    if (imgs.length === 0 && !t) throw new UserError('スクショを選ぶか、予約内容の文章を貼り付けてください');
    if (imgs.length > 5) throw new UserError('画像は5枚までにしてください');
    let raws: RawReservation[];
    try {
      raws = readReservations(ctx, { images: imgs, text: t || undefined });
    } catch (e) {
      ctx.log('read error', e);
      throw new UserError(`予約内容を読み取れませんでした（${e instanceof Error ? e.message : String(e)}）。手で入力してください。`);
    }
    const d = buildDraft(ctx, me, raws);
    return { items: d.items, incomplete: d.incomplete, pastCount: d.pastCount, duplicateCount: d.duplicateCount ?? 0 };
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
    return { ...result, practices: handlers.listPractices(ctx, me, {}) };
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

  /** 練習をやめるときは削除する（中止として残さない）。グループへの通知は送らない */
  deletePractice(ctx, me, { id }) {
    ctx.withLock(() => {
      const p = getPracticeOrThrow(ctx, id);
      requireEditable(me, p);
      ctx.store.deletePractice(id);
    });
    return handlers.listPractices(ctx, me, {});
  },

  recruitPractice(ctx, me, { id, groups }) {
    const p = getPracticeOrThrow(ctx, id);
    requireEditable(me, p);
    if (!isActive(p)) throw new UserError('募集中の練習だけ募集を送れます');
    if (p.date < toJstDate(ctx.now())) throw new UserError('終わった練習には募集を送れません');
    const known = new Set(ctx.store.settings().groups.map((g) => g.id));
    // 同じグループに二重に流さない
    const targets = [...new Set(groups ?? [])].filter((g) => known.has(g) && !p.groups.includes(g));
    if (targets.length === 0) throw new UserError('募集を送るグループを選んでください');
    const sent = sendRecruit(ctx, [p], targets, memberNameOf(ctx, p.booker));
    if (sent.length === 0) throw new UserError('募集を送れませんでした。時間をおいてもう一度お試しください');
    ctx.withLock(() => {
      const cur = getPracticeOrThrow(ctx, id);
      ctx.store.savePractice({ ...cur, groups: [...new Set([...cur.groups, ...sent])] });
    });
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
      const ids = new Set(ctx.store.settings().groups.map((g) => g.id));
      if (patch.defaultGroups !== undefined) next.defaultGroups = patch.defaultGroups.filter((g) => ids.has(g));
      // 今は無いグループの記録は残す（招待し直したときに、また見えるように）
      if (patch.groups !== undefined) {
        if (!Array.isArray(patch.groups)) throw new UserError('グループの指定が不正です');
        next.groups = [...new Set([...patch.groups.filter((g) => ids.has(g)), ...m.groups.filter((g) => !ids.has(g))])];
        // 外したグループは、覚え済みの目印も消す（発言やボタンで、すぐまた付けられるように）
        for (const g of m.groups.filter((x) => !next.groups.includes(x))) ctx.kv.remove(inGroupKey(g, userId));
      }
      ctx.store.saveMember(next);
      return next;
    });
  },

  listFeedback(ctx, me) {
    return feedbackList(ctx, me);
  },

  postFeedback(ctx, me, { text }) {
    const t = typeof text === 'string' ? text.trim().slice(0, 1000) : '';
    if (!t) throw new UserError('要望を入力してください');
    ctx.withLock(() =>
      ctx.store.saveFeedback({ id: ctx.uuid(), userId: me.userId, name: me.name, text: t, status: '未対応', reply: '', createdAt: ctx.now().toISOString() }),
    );
    return feedbackList(ctx, me);
  },

  updateFeedback(ctx, me, { id, status, reply }) {
    requireAdmin(me);
    ctx.withLock(() => {
      const f = ctx.store.feedback().find((x) => x.id === id);
      if (!f) throw new UserError('要望が見つかりません');
      if (status !== undefined && !FEEDBACK_STATUSES.includes(status)) throw new UserError('状態が不正です');
      ctx.store.saveFeedback({ ...f, status: status ?? f.status, reply: reply !== undefined ? String(reply).trim().slice(0, 1000) : f.reply });
    });
    return feedbackList(ctx, me);
  },

  deleteFeedback(ctx, me, { id }) {
    ctx.withLock(() => {
      const f = ctx.store.feedback().find((x) => x.id === id);
      if (!f) return;
      if (!canDeleteFeedback(me, f)) throw new UserError('投稿した本人か管理者だけが消せます');
      ctx.store.deleteFeedback(id);
    });
    return feedbackList(ctx, me);
  },

  updateSettings(ctx, me, params) {
    requireAdmin(me);
    return ctx.withLock(() => {
      const s = ctx.store.settings();
      const next: Settings = {
        ...s,
        studios: params.studios === undefined ? s.studios : cleanStudios(params.studios),
        fees: (params.fees ?? [])
          .filter((f) => f.studio?.trim())
          .map((f) => {
            const from = normalizeTime(f.from ?? '') ?? '';
            const to = normalizeTime(f.to ?? '') ?? '';
            return {
              studio: f.studio.trim(),
              room: (f.room ?? '').trim(),
              days: f.days === '平日' || f.days === '土日祝' ? f.days : '',
              from: from && to ? from : '',
              to: from && to ? to : '',
              fee: nonNegative(f.fee) ?? 0,
            };
          }),
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
      return publicSettings(next);
    });
  },
};

/** 管理画面から来たスタジオ・部屋の一覧を整える（空の行は捨て、同じ名前はまとめる） */
function cleanStudios(list: StudioDef[]): StudioDef[] {
  const out: StudioDef[] = [];
  for (const st of Array.isArray(list) ? list : []) {
    const name = String(st?.name ?? '').trim().slice(0, 50);
    if (!name || out.some((x) => x.name === name)) continue;
    const rooms: StudioDef['rooms'] = [];
    for (const r of Array.isArray(st.rooms) ? st.rooms : []) {
      const rn = String(r?.name ?? '').trim().slice(0, 30);
      if (rn && !rooms.some((x) => x.name === rn)) rooms.push({ name: rn, size: String(r?.size ?? '').trim().slice(0, 60) });
    }
    const aliases = (Array.isArray(st.aliases) ? st.aliases : []).map((a) => String(a).trim()).filter(Boolean).slice(0, 20);
    out.push({ name, aliases, rooms });
  }
  if (out.length === 0) throw new UserError('スタジオを1つ以上登録してください');
  return out;
}

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
