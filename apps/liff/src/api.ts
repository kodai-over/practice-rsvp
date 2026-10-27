import type { ApiAction, ApiActions, ApiResponse, JoinActions } from '@studio-attendance/shared';

export const MOCK = import.meta.env.MODE === 'mock' || import.meta.env.VITE_MOCK === '1';
const GAS_URL = import.meta.env.VITE_GAS_URL as string;

export class ApiError extends Error {}

let idTokenProvider: () => string | null = () => null;
// LIFF の初期化が終わるまで通信を待たせる（前回の表示を先に出すため、画面は初期化より先に動き出す）
let markReady: () => void = () => {};
const ready = new Promise<void>((resolve) => (markReady = resolve));
export { markReady };
let onAuthExpired: () => void = () => {};

export function configureAuth(getToken: () => string | null, expired: () => void) {
  idTokenProvider = getToken;
  onAuthExpired = expired;
}

async function post<T>(body: Record<string, unknown>): Promise<T> {
  let res: ApiResponse<T>;
  if (MOCK) {
    const { mockRoute } = await import('./mock');
    res = (await mockRoute(body)) as ApiResponse<T>;
  } else {
    // text/plain にするとプリフライトが起きず、Apps Script でも受けられる
    const r = await fetch(GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    if (!r.ok) throw new ApiError(`通信に失敗しました（${r.status}）`);
    res = await r.json();
  }
  if (!res.ok) {
    if (res.error.includes('ログインの有効期限')) onAuthExpired();
    throw new ApiError(res.error);
  }
  return res.data;
}

/** LINE内アプリの操作。IDトークンを毎回付け、サーバー側で本人を確かめる */
export function api<A extends ApiAction>(action: A, params: ApiActions[A]['params'] = {} as ApiActions[A]['params']) {
  return ready.then(() => post<ApiActions[A]['result']>({ kind: 'api', idToken: idTokenProvider(), action, params }));
}

/** 参加リンクのページの操作（LINEログインなし） */
export function joinApi<A extends keyof JoinActions>(action: A, params: JoinActions[A]['params']) {
  return post<JoinActions[A]['result']>({ kind: 'join', action, params });
}
