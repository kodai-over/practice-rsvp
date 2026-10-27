import type { Attendance, Feedback, Member, Practice } from './types';

/** 練習の登録（スクショ送信・アプリでの登録）はメンバーなら誰でもできる */
export function canRegister(m: Member | null): boolean {
  return m != null;
}

export function isAdmin(m: Member | null): boolean {
  return m != null && m.role === '管理者';
}

/**
 * 練習が見えるのは、管理者・予約者・募集を送ったグループに入っている人・出欠に関わった人（involved）だけ。
 * 例: グループ1にだけ募集した練習は、グループ2にしかいない人には見えない
 */
export function canSeePractice(m: Member | null, p: Practice, involved = false): boolean {
  return m != null && (m.role === '管理者' || p.booker === m.userId || involved || p.groups.some((g) => m.groups.includes(g)));
}

/** 練習の修正・中止・金額調整ができるのは、その練習の予約者と管理者だけ */
export function canEditPractice(m: Member | null, p: Practice): boolean {
  return m != null && (m.role === '管理者' || p.booker === m.userId);
}

/** 出欠の取り消し：予約者・管理者・追加した本人・回答した本人 */
export function canRemoveAttendance(m: Member | null, p: Practice, a: Attendance): boolean {
  if (m == null) return false;
  return canEditPractice(m, p) || a.addedBy === m.userId || a.participant === m.userId;
}

/** 要望を消せるのは投稿した本人と管理者 */
export function canDeleteFeedback(m: Member | null, f: Feedback): boolean {
  return m != null && (m.role === '管理者' || f.userId === m.userId);
}
