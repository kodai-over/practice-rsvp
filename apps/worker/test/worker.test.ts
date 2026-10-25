import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import worker, { relayPayload, verifyLineSignature } from '../src/index';

const SECRET = 'channel-secret';
const body = JSON.stringify({ destination: 'U', events: [{ type: 'message', message: { text: '練習' } }] });
const sign = (b: string) => createHmac('sha256', SECRET).update(b).digest('base64');

describe('LINE署名', () => {
  it('正しい署名だけ通す', async () => {
    expect(await verifyLineSignature(body, sign(body), SECRET)).toBe(true);
    expect(await verifyLineSignature(body + ' ', sign(body), SECRET)).toBe(false);
    expect(await verifyLineSignature(body, null, SECRET)).toBe(false);
  });
});

describe('中継', () => {
  it('GASが検証する形式（hex HMAC of ts.body）と一致する', async () => {
    const p = JSON.parse(await relayPayload(body, 'relay', 123));
    expect(p.mac).toBe(createHmac('sha256', 'relay').update(`123.${body}`, 'utf8').digest('hex'));
    expect(p.body).toBe(body);
  });

  it('不正な署名は401、正しければ200を返してGASへ送る', async () => {
    const sent: RequestInit[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent.push(init);
      return new Response('', { status: 302 });
    }) as typeof fetch;
    const waits: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
    const env = { LINE_CHANNEL_SECRET: SECRET, RELAY_SECRET: 'relay', GAS_URL: 'https://gas' };
    try {
      const bad = await worker.fetch(new Request('https://w', { method: 'POST', body, headers: { 'x-line-signature': 'x' } }), env, ctx);
      expect(bad.status).toBe(401);
      const ok = await worker.fetch(new Request('https://w', { method: 'POST', body, headers: { 'x-line-signature': sign(body) } }), env, ctx);
      expect(ok.status).toBe(200);
      await Promise.all(waits);
      expect(sent).toHaveLength(1);
      expect(JSON.parse(String(sent[0].body)).kind).toBe('line');
    } finally {
      globalThis.fetch = orig;
    }
  });
});
