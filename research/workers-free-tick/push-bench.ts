// THROWAWAY (issue #50): CPU of sending one Web Push with the shipped code (RFC 8291 encryption + VAPID
// JWT, all WebCrypto), fetch faked. Run from the repo root:
//   node --experimental-strip-types --disable-warning=ExperimentalWarning research/workers-free-tick/push-bench.ts
import { performance } from 'node:perf_hooks';
import { b64url, sendPush } from '@orc/server';

const ecdsa = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
const vapid = {
  publicKey: b64url(new Uint8Array(await crypto.subtle.exportKey('raw', ecdsa.publicKey))),
  privateKey: (await crypto.subtle.exportKey('jwk', ecdsa.privateKey)).d!,
  subject: 'mailto:orcs@example.com',
};
const device = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
const sub = {
  p256dh: b64url(new Uint8Array(await crypto.subtle.exportKey('raw', device.publicKey))),
  auth: b64url(crypto.getRandomValues(new Uint8Array(16))),
};
const fakeFetch = (async () => new Response(null, { status: 201 })) as typeof fetch;
const payload = JSON.stringify({ title: 'Krúg is dead', body: 'He tried to arm-wrestle a troll. The troll won.', url: '/?world=x&story=1', tag: 'story-x-1' });

const times: number[] = [];
for (let i = 0; i < 200; i++) {
  const a = performance.now();
  await sendPush('https://fcm.googleapis.com/fcm/send/abc', sub, payload, { fetch: fakeFetch, vapid, nowMs: Date.now(), ttl: 14400 });
  times.push(performance.now() - a);
}
const s = [...times].sort((x, y) => x - y);
console.log(`one push (encrypt + VAPID sign, fetch faked), ms: first ${times[0]!.toFixed(2)}, p50 ${s[100]!.toFixed(3)}, p95 ${s[190]!.toFixed(3)}, max ${s[199]!.toFixed(2)}`);
