import type { Verifiers } from '../app/router';

function hex(bytes: number[]): string {
  return bytes.map((b) => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Worker と同じく HMAC-SHA256(RELAY_SECRET, `${ts}.${body}`) の16進 */
export function relayMac(secret: string, ts: number, body: string): string {
  return hex(Utilities.computeHmacSha256Signature(`${ts}.${body}`, secret, Utilities.Charset.UTF_8));
}

export function makeVerifiers(props: { relaySecret: string; loginChannelId: string }): Verifiers {
  const cache = CacheService.getScriptCache();
  return {
    relay(ts, body, mac) {
      if (!props.relaySecret) return false;
      return safeEqual(relayMac(props.relaySecret, ts, body), mac.toLowerCase());
    },
    idToken(token) {
      if (!props.loginChannelId) return null;
      const key = 'idt:' + hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token, Utilities.Charset.UTF_8));
      const hit = cache.get(key);
      if (hit) return JSON.parse(hit);
      const res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
        method: 'post',
        payload: { id_token: token, client_id: props.loginChannelId },
        muteHttpExceptions: true,
      });
      if (res.getResponseCode() !== 200) return null;
      const claims = JSON.parse(res.getContentText()) as { sub?: string; name?: string; exp?: number };
      if (!claims.sub) return null;
      const user = { userId: claims.sub, name: claims.name };
      const ttl = Math.min(600, Math.floor((claims.exp ?? 0) - Date.now() / 1000));
      if (ttl > 0) cache.put(key, JSON.stringify(user), ttl);
      return user;
    },
  };
}
