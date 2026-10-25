/**
 * LINE Webhook の受け口。LINEの署名を確かめてから Apps Script に中継する。
 * Apps Script はリクエストヘッダーを読めないため、中継用の署名（ts と本文のHMAC）を本文に入れて渡す。
 */
export interface Env {
  LINE_CHANNEL_SECRET: string;
  RELAY_SECRET: string;
  GAS_URL: string;
}

const enc = new TextEncoder();

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

const toBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyLineSignature(body: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature || !secret) return false;
  return safeEqual(toBase64(await hmac(secret, body)), signature);
}

export async function relayPayload(body: string, secret: string, ts: number): Promise<string> {
  const mac = toHex(await hmac(secret, `${ts}.${body}`));
  return JSON.stringify({ kind: 'line', ts, body, mac });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method !== 'POST') return new Response('ok');
    const body = await req.text();
    if (!(await verifyLineSignature(body, req.headers.get('x-line-signature'), env.LINE_CHANNEL_SECRET))) {
      return new Response('invalid signature', { status: 401 });
    }
    const payload = await relayPayload(body, env.RELAY_SECRET, Date.now());
    // LINE にはすぐ200を返し、Apps Script の処理（スクショ読み取りなど）は裏で待つ。
    // Apps Script は 302 を返す前に doPost を実行し終えるので、リダイレクト先は追わない。
    ctx.waitUntil(
      fetch(env.GAS_URL, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: payload, redirect: 'manual' })
        .then((r) => {
          if (r.status >= 400) console.error('GAS responded', r.status);
        })
        .catch((e) => console.error('relay failed', e)),
    );
    return new Response('ok');
  },
};
