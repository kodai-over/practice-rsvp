import type { LineMessage } from '@studio-attendance/shared';
import type { Image, LineApi } from '../app/ports';

const API = 'https://api.line.me/v2/bot';
const DATA_API = 'https://api-data.line.me/v2/bot';

export class LineClient implements LineApi {
  constructor(private readonly token: string) {}

  private fetch(method: 'get' | 'post', url: string, payload?: unknown, headers: Record<string, string> = {}) {
    const res = UrlFetchApp.fetch(url, {
      method,
      contentType: 'application/json',
      headers: { Authorization: `Bearer ${this.token}`, ...headers },
      payload: payload === undefined ? undefined : JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code === 404) return null;
    if (code >= 300) throw new Error(`LINE API ${url} ${code}: ${res.getContentText()}`);
    return res;
  }

  private json<T>(url: string): T | null {
    const res = this.fetch('get', url);
    return res ? (JSON.parse(res.getContentText()) as T) : null;
  }

  reply(replyToken: string, messages: LineMessage[]) {
    this.fetch('post', `${API}/message/reply`, { replyToken, messages });
  }

  push(to: string, messages: LineMessage[]) {
    // 再送時に二重送信されないよう Retry Key を付ける
    this.fetch('post', `${API}/message/push`, { to, messages }, { 'X-Line-Retry-Key': Utilities.getUuid() });
  }

  profile(userId: string) {
    return this.json<{ displayName: string }>(`${API}/profile/${userId}`);
  }

  groupMemberProfile(groupId: string, userId: string) {
    return this.json<{ displayName: string }>(`${API}/group/${groupId}/member/${userId}`);
  }

  groupSummary(groupId: string) {
    return this.json<{ groupName: string }>(`${API}/group/${groupId}/summary`);
  }

  showLoading(userId: string, seconds: number) {
    // 送信数には数えられない。5〜60秒、5秒刻み
    const s = Math.min(60, Math.max(5, Math.round(seconds / 5) * 5));
    this.fetch('post', `${API}/chat/loading/start`, { chatId: userId, loadingSeconds: s });
  }

  content(messageId: string): Image {
    const res = this.fetch('get', `${DATA_API}/message/${messageId}/content`);
    if (!res) throw new Error('画像を取得できませんでした');
    const blob = res.getBlob();
    return { mimeType: blob.getContentType() || 'image/jpeg', data: Utilities.base64Encode(blob.getBytes()) };
  }
}
