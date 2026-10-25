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
}

export interface CreateResult {
  created: string[];
  extended: string[];
  skipped: string[];
}

export type PracticePatch = Partial<Pick<Practice, 'start' | 'end' | 'room' | 'fee' | 'max' | 'min' | 'memo' | 'feeOverride'>>;

export interface ApiActions {
  me: { params: Record<string, never>; result: MeView };
  listPractices: { params: Record<string, never>; result: PracticeView[] };
  getPractice: { params: { id: string }; result: PracticeView };
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
  cancelPractice: { params: { id: string }; result: PracticeView };
  setDisplayName: { params: { name: string }; result: Member };
  listMembers: { params: Record<string, never>; result: Member[] };
  updateMember: { params: { userId: string; patch: Partial<Pick<Member, 'name' | 'role' | 'defaultGroups'>> }; result: Member };
  renameGroup: { params: { id: string; name: string }; result: Group[] };
  listFeedback: { params: Record<string, never>; result: FeedbackView[] };
  postFeedback: { params: { text: string }; result: FeedbackView[] };
  updateFeedback: { params: { id: string; status?: FeedbackStatus; reply?: string }; result: FeedbackView[] };
  deleteFeedback: { params: { id: string }; result: FeedbackView[] };
  updateSettings: {
    params: { fees: FeeRule[]; cancelRules: CancelRule[]; minDefault: number; roundUnit: number };
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
