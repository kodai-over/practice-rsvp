import type { ApiResponse } from '@studio-attendance/shared';
import { handleApi } from './api';
import { handleJoin } from './join';
import { UserError, type Ctx } from './ports';
import { handleWebhook } from './webhook';

export interface Verifiers {
  /** Worker が付けた中継用署名を確かめる */
  relay(ts: number, body: string, mac: string): boolean;
  /** LINEログインのIDトークンを確かめ、ユーザーを返す。無効なら null */
  idToken(token: string): { userId: string; name?: string } | null;
}

const RELAY_MAX_SKEW_MS = 5 * 60 * 1000;

/** doPost の本文を種類ごとに振り分ける */
export function route(ctx: Ctx, raw: string, verify: Verifiers): ApiResponse<unknown> {
  let req: Record<string, unknown>;
  try {
    req = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'bad request' };
  }
  try {
    switch (req.kind) {
      case 'line': {
        const { ts, body, mac } = req as { ts: number; body: string; mac: string };
        if (typeof body !== 'string' || typeof mac !== 'string' || typeof ts !== 'number') return { ok: false, error: 'bad request' };
        if (Math.abs(ctx.now().getTime() - ts) > RELAY_MAX_SKEW_MS || !verify.relay(ts, body, mac)) {
          return { ok: false, error: 'forbidden' };
        }
        handleWebhook(ctx, JSON.parse(body));
        return { ok: true, data: null };
      }
      case 'api': {
        const auth = typeof req.idToken === 'string' ? verify.idToken(req.idToken) : null;
        if (!auth) return { ok: false, error: 'ログインの有効期限が切れました。アプリを開き直してください。' };
        return { ok: true, data: handleApi(ctx, { ...auth, actAs: req.actAs }, String(req.action), req.params) };
      }
      case 'join':
        return { ok: true, data: handleJoin(ctx, String(req.action), (req.params ?? {}) as Record<string, unknown>) };
      default:
        return { ok: false, error: 'bad request' };
    }
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    ctx.log('route error', e instanceof Error ? e.stack : e);
    return { ok: false, error: 'エラーが起きました。時間をおいてもう一度お試しください。' };
  }
}
