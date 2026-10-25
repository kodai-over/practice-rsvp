import type { LineMessage } from '@pb/shared';
import { MemoryKv, MemoryStore } from '../src/app/memory';
import type { Ctx, Image, LineApi, ReaderHints, ReaderInput, ScreenshotReader } from '../src/app/ports';

export class FakeLine implements LineApi {
  replies: { token: string; messages: LineMessage[] }[] = [];
  pushes: { to: string; messages: LineMessage[] }[] = [];
  failReply = false;
  profiles: Record<string, string> = {};

  reply(token: string, messages: LineMessage[]) {
    if (this.failReply) throw new Error('Invalid reply token');
    this.replies.push({ token, messages });
  }
  push(to: string, messages: LineMessage[]) {
    this.pushes.push({ to, messages });
  }
  profile(userId: string) {
    return this.profiles[userId] ? { displayName: this.profiles[userId] } : null;
  }
  groupMemberProfile(_g: string, userId: string) {
    return this.profile(userId);
  }
  groupSummary(groupId: string) {
    return { groupName: `名前-${groupId}` };
  }
  loadings: string[] = [];
  showLoading(userId: string) {
    this.loadings.push(userId);
  }
  content(messageId: string): Image {
    return { mimeType: 'image/jpeg', data: messageId };
  }
  lastReplyText(): string {
    return JSON.stringify(this.replies.at(-1)?.messages ?? []);
  }
}

export class FakeReader implements ScreenshotReader {
  calls: { input: ReaderInput; hints: ReaderHints }[] = [];
  result: Record<string, unknown>[] = [];
  read(input: ReaderInput, hints: ReaderHints) {
    this.calls.push({ input, hints });
    return this.result;
  }
}

export function makeTestCtx(now = '2026-10-10T03:00:00Z') {
  const store = new MemoryStore();
  const line = new FakeLine();
  const reader = new FakeReader();
  const kv = new MemoryKv();
  let seq = 0;
  const clock = { now: new Date(now) };
  const ctx: Ctx = {
    store,
    line,
    reader,
    kv,
    withLock: (fn) => fn(),
    config: { appUrl: 'https://liff.line.me/APP', joinPageUrl: 'https://pages.example/join.html', gasUrl: 'https://script.example/exec' },
    now: () => clock.now,
    uuid: () => `uuid${++seq}`,
    log: () => {},
  };
  return { ctx, store, line, reader, kv, clock };
}
