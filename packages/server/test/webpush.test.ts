// Web Push over VAPID (RFC 8291 message encryption, RFC 8292 VAPID), on WebCrypto only. The encryption
// is pinned by RFC 8291's own worked example (§5 and Appendix A); VAPID by verifying the JWT's signature.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { b64url, encryptPayload, fromB64url, vapidAuthorization, vapidFromEnv } from '@orc/server';

type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
const join = (s: string) => s.replace(/\s+/g, '');

test("encrypts RFC 8291's example message byte for byte", async () => {
  const body = await encryptPayload(
    { p256dh: join('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcx aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'), auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
    new TextEncoder().encode('When I grow up, I want to be a watermelon'),
    {
      salt: fromB64url('DGv6ra1nlYgDCS1FRnbzlw'),
      serverKeys: {
        publicKey: join('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIg Dll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'),
        privateKey: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
      },
    },
  );
  // RFC 8291 §5: the request body.
  assert.equal(
    b64url(body),
    join(`DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
          mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
          pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`),
  );
  assert.equal(body.length, 86 + 41 + 1 + 16, "header + message + delimiter + tag (the RFC says Content-Length 145: an erratum)");
});

test('a fresh key pair and salt each time, so the same message never encrypts the same way twice', async () => {
  const sub = { p256dh: join('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcx aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'), auth: 'BTBZMqHH6r4Tts7J_aSIgg' };
  const msg = new TextEncoder().encode('hi');
  const [a, b] = [await encryptPayload(sub, msg), await encryptPayload(sub, msg)];
  assert.notEqual(b64url(a), b64url(b));
  assert.equal(a.length, 86 + 2 + 1 + 16, 'header + message + delimiter + tag');
});

test('the VAPID header is an ES256 JWT for the push service origin, signed by our key', async () => {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as { publicKey: Key; privateKey: Key };
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicKey = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  const vapid = { publicKey, privateKey: jwk.d!, subject: 'mailto:orcs@example.com' };

  const now = Date.parse('2026-10-30T12:00:00Z');
  const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', vapid, now);
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.ok(m, header);
  assert.equal(m[2], publicKey);
  const [h, c, s] = m[1]!.split('.');
  assert.deepEqual(JSON.parse(new TextDecoder().decode(fromB64url(h!))), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(new TextDecoder().decode(fromB64url(c!))), {
    aud: 'https://fcm.googleapis.com',
    exp: now / 1000 + 12 * 3600,
    sub: 'mailto:orcs@example.com',
  });
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    pair.publicKey,
    fromB64url(s!),
    new TextEncoder().encode(`${h}.${c}`),
  );
  assert.ok(ok, 'signature verifies');
});

test('VAPID keys come from the environment, and missing ones mean no pushes', () => {
  const env = (vars: Record<string, string>) => (name: string) => vars[name];
  assert.equal(vapidFromEnv(env({})), null);
  assert.equal(vapidFromEnv(env({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: '' })), null);
  assert.deepEqual(vapidFromEnv(env({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' })), {
    publicKey: 'pub',
    privateKey: 'priv',
    subject: 'mailto:orc-nonsense@example.com',
  });
  assert.equal(vapidFromEnv(env({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:a@b.c' }))!.subject, 'mailto:a@b.c');
});
