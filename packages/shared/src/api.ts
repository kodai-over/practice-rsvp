/** LINE内アプリ・参加リンクページと Apps Script の間のやり取りの型 */
import type {
  Answer,
  AttendeeKind,
  CancelRule,
  Draft,
  DraftItem,
  FeeRule,
  FeedbackStatus,
  Group,
  Member,
  Practice,
  Reservation,
  Settings,
  StudioDef,
  Via,
} from './types';

export interface AttendeeView {
  participant: string;
  name: string;
  kind: AttendeeKind;
  via: Via;
  answer: Answer;
  addedByName: string | null;
  canRemove: boolean;
}

export interface PracticeView {
  practice: Omit<Practice, 'joinKey'>;
  bookerName: string;
  groupNames: string[];
  going: AttendeeView[];
  /** 保留（まだ決めていない） */
  maybe: AttendeeView[];
  notGoing: AttendeeView[];
  goingCount: number;
  perPerson: number | null;
  myAnswer: Answer | null;
  canEdit: boolean;
  joinUrl: string | null;
  icsUrl: string;
  googleCalendarUrl: string;
}

export interface FeedbackView {
  id: string;
  name: string;
  text: string;
  status: FeedbackStatus;
  reply: string;
  createdAt: string;
  mine: boolean;
  canDelete: boolean;
}

export interface MeView {
  member: Member;
  groups: Group[];
  settings: Settings;
}

export interface NewPracticeInput extends Reservation {
  max: number | null;
  min: number | null;
  memo: string;
}

export interface ParseResult {
  items: DraftItem[];
  incomplete: Partial<Reservation>[];
  pastCount: number;
  duplicateCount: number;
}

export interface CreateResult {
  created: string[];
  extended: string[];
  skipped: string[];
  /** 募集を送れたグループ */
  recruited?: string[];
  /** 登録後の練習一覧（アプリが取り直さずに表示を更新できるように） */
  practices?: PracticeView[];
}

export type PracticePatch = Partial<Pick<Practice, 'start' | 'end' | 'room' | 'fee' | 'max' | 'min' | 'memo' | 'feeOverride'>>;

export interface HomeView {
  me: MeView;
  practices: PracticeView[];
}

export interface ApiActions {
  me: { params: Record<string, never>; result: MeView };
  /** 起動時に1回で取る（自分の情報と今後の練習の一覧） */
  home: { params: Record<string, never>; result: HomeView };
  listPractices: { params: Record<string, never>; result: PracticeView[] };
  getPractice: { params: { id: string }; result: PracticeView };
  /** グループのカードから開いたとき。グループの合言葉が合えば、開いた人をそのグループのメンバーとして覚える */
  openedFromGroup: { params: { group: string; key: string }; result: null };
  rsvp: { params: { id: string; answer: Answer }; result: PracticeView };
  addGuest: { params: { id: string; name: string }; result: PracticeView };
  removeAttendance: { params: { id: string; participant: string }; result: PracticeView };
  appendMemo: { params: { id: string; text: string }; result: PracticeView };
  /** スクショ（images）か予約内容の文章（text）から予約を読み取る */
  parseReservations: { params: { images?: { mimeType: string; data: string }[]; text?: string }; result: ParseResult };
  getDraft: { params: { id: string }; result: Draft | null };
  classify: { params: { reservations: Reservation[] }; result: DraftItem[] };
  createPractices: { params: { items: NewPracticeInput[]; groups: string[]; draftId?: string }; result: CreateResult };
  updatePractice: { params: { id: string; patch: PracticePatch }; result: PracticeView };
  /** 練習を消す。募集を流したグループには中止を知らせる。結果は消したあとの一覧 */
  deletePractice: { params: { id: string }; result: PracticeView[] };
  /** 登録済みの練習の募集を、まだ送っていないグループに流す */
  recruitPractice: { params: { id: string; groups: string[] }; result: PracticeView };
  setDisplayName: { params: { name: string }; result: Member };
  listMembers: { params: Record<string, never>; result: Member[] };
  updateMember: { params: { userId: string; patch: Partial<Pick<Member, 'name' | 'role' | 'defaultGroups' | 'groups'>> }; result: Member };
  listFeedback: { params: Record<string, never>; result: FeedbackView[] };
  postFeedback: { params: { text: string }; result: FeedbackView[] };
  updateFeedback: { params: { id: string; status?: FeedbackStatus; reply?: string }; result: FeedbackView[] };
  deleteFeedback: { params: { id: string }; result: FeedbackView[] };
  updateSettings: {
    params: { studios?: StudioDef[]; fees: FeeRule[]; cancelRules: CancelRule[]; minDefault: number; roundUnit: number };
    result: Settings;
  };
}

export type ApiAction = keyof ApiActions;

export interface JoinView {
  id: string;
  date: string;
  start: string;
  end: string;
  studio: string;
  room: string;
  /** 部屋の広さなどの補足 */
  roomInfo: string | null;
  memo: string;
  status: Practice['status'];
  goingCount: number;
  perPerson: number | null;
  /** 参加リンクで回答した本人の回答（participant を渡したとき） */
  myAnswer: Answer | null;
}

export interface JoinActions {
  get: { params: { id: string; key: string; participant?: string }; result: JoinView };
  answer: {
    params: { id: string; key: string; name: string; answer: Answer; participant?: string };
    result: JoinView & { participant: string };
  };
}

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string };
