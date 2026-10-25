/** インメモリの Store / Kv。テストと、LINE内アプリのモック表示で使う */
import type { Attendance, Feedback, Member, Practice, Settings } from '@pb/shared';
import type { Kv, Store } from './ports';
import { rowsToSettings, settingsToRows } from './schema';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export class MemoryStore implements Store {
  p: Practice[] = [];
  a: Attendance[] = [];
  m: Member[] = [];
  s: Settings = { studios: [], fees: [], cancelRules: [], minDefault: 3, roundUnit: 10, groups: [] };
  f: Feedback[] = [];

  practices() {
    return clone(this.p);
  }
  getPractice(id: string) {
    return clone(this.p.find((x) => x.id === id) ?? null);
  }
  savePractice(p: Practice) {
    const i = this.p.findIndex((x) => x.id === p.id);
    if (i >= 0) this.p[i] = clone(p);
    else this.p.push(clone(p));
  }
  deletePractice(id: string) {
    this.p = this.p.filter((x) => x.id !== id);
    this.a = this.a.filter((x) => x.practiceId !== id);
  }
  attendance(practiceId?: string) {
    return clone(this.a.filter((x) => !practiceId || x.practiceId === practiceId));
  }
  saveAttendance(a: Attendance) {
    const i = this.a.findIndex((x) => x.practiceId === a.practiceId && x.participant === a.participant);
    if (i >= 0) this.a[i] = clone(a);
    else this.a.push(clone(a));
  }
  deleteAttendance(practiceId: string, participant: string) {
    this.a = this.a.filter((x) => !(x.practiceId === practiceId && x.participant === participant));
  }
  members() {
    return clone(this.m);
  }
  getMember(userId: string) {
    return clone(this.m.find((x) => x.userId === userId) ?? null);
  }
  saveMember(m: Member) {
    const i = this.m.findIndex((x) => x.userId === m.userId);
    if (i >= 0) this.m[i] = clone(m);
    else this.m.push(clone(m));
  }
  settings() {
    // シートへの書き込みと読み直しを通す
    return rowsToSettings(settingsToRows(this.s));
  }
  saveSettings(s: Settings) {
    this.s = clone(s);
  }
  feedback() {
    return clone(this.f);
  }
  saveFeedback(f: Feedback) {
    const i = this.f.findIndex((x) => x.id === f.id);
    if (i >= 0) this.f[i] = clone(f);
    else this.f.push(clone(f));
  }
  deleteFeedback(id: string) {
    this.f = this.f.filter((x) => x.id !== id);
  }
}

export class MemoryKv implements Kv {
  data = new Map<string, string>();
  get(k: string) {
    return this.data.get(k) ?? null;
  }
  put(k: string, v: string) {
    this.data.set(k, v);
  }
  remove(k: string) {
    this.data.delete(k);
  }
}
