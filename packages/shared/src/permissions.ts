import type { Attendance, Member, Practice } from './types';

export function canRegister(m: Member | null): boolean {
  return m != null && (m.role === '管理者' || m.role === '予約者');
}

export function isAdmin(m: Member | null): boolean {
  return m != null && m.role === '管理者';
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
