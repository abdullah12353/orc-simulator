// #52 item 6: the Worker verifies Neon Auth JWTs locally against cached JWKS (EdDSA), checking the
// signature, `iss` and `exp`. No database: keys are made here and the JWKS endpoint is a fake `fetch`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { bearerToken, JWKS_CACHE, jwtVerifier } from '@orc/server';

const ISSUER = 'https://ep-test.neonauth.example.neon.tech';
const JWKS_URL = `${ISSUER}/neondb/auth/.well-known/jwks.json`;
const USER = 'fd14bce2-996b-4b3b-a31b-7070d157a331';

async function keyPair(kid: string) {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
  return { kid, privateKey, jwk: { ...(await exportJWK(publicKey)), kid, alg: 'EdDSA' } };
}

function sign(key: { kid: string; privateKey: CryptoKey }, claims: { sub?: string; iss?: string; expSec?: number }, nowMs: number) {
  const jwt = new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'EdDSA', kid: key.kid })
    .setIssuer(claims.iss ?? ISSUER)
    .setIssuedAt(Math.floor(nowMs / 1000))
    .setExpirationTime(Math.floor(nowMs / 1000) + (claims.expSec ?? 900));
  if (claims.sub !== undefined) jwt.setSubject(claims.sub);
  return jwt.sign(key.privateKey);
}

/** A JWKS endpoint serving `keys()`, counting fetches. */
function jwksServer(keys: () => object[]) {
  let fetches = 0;
  const fetch = (async (url: string | URL) => {
    assert.equal(String(url), JWKS_URL);
    fetches++;
    return new Response(JSON.stringify({ keys: keys() }), { headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { fetch, fetches: () => fetches };
}

test('a valid Neon Auth token gives its user id, with one JWKS fetch for many requests', async () => {
  let now = Date.parse('2026-11-06T23:00:00Z');
  const key = await keyPair('k1');
  const server = jwksServer(() => [key.jwk]);
  const verify = jwtVerifier({ jwksUrl: JWKS_URL, issuer: ISSUER, fetch: server.fetch, now: () => now });

  for (let i = 0; i < 5; i++) assert.equal(await verify(await sign(key, { sub: USER }, now)), USER);
  assert.equal(server.fetches(), 1, 'the keys are cached in memory');

  now += JWKS_CACHE.maxAgeMs + 1;
  assert.equal(await verify(await sign(key, { sub: USER }, now)), USER);
  assert.equal(server.fetches(), 2, 'refetched once they are an hour old');
});

test('a token that is expired, from another issuer, badly signed, unsigned or garbage gives no user', async () => {
  const now = Date.parse('2026-11-06T23:00:00Z');
  const key = await keyPair('k1');
  const forger = await keyPair('k1'); // the same kid, the wrong key
  const verify = jwtVerifier({ jwksUrl: JWKS_URL, issuer: ISSUER, fetch: jwksServer(() => [key.jwk]).fetch, now: () => now });

  assert.equal(await verify(await sign(key, { sub: USER, expSec: -60 }, now)), null, 'expired');
  assert.equal(await verify(await sign(key, { sub: USER, iss: 'https://evil.example' }, now)), null, 'another issuer');
  assert.equal(await verify(await sign(forger, { sub: USER }, now)), null, 'signed by another key');
  assert.equal(await verify(await sign(key, {}, now)), null, 'no subject');
  const [h, p] = (await sign(key, { sub: USER }, now)).split('.');
  const none = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${p}.`;
  assert.equal(await verify(none), null, 'alg none');
  assert.equal(await verify(`${h}.${p}.`), null, 'signature stripped');
  assert.equal(await verify('not-a-jwt'), null, 'garbage');
});

test('a token signed by a key we have not seen refetches the keys (a rotation), at most once per cooldown', async () => {
  const t0 = Date.parse('2026-11-06T23:00:00Z');
  let now = t0;
  const old = await keyPair('old');
  const rotated = await keyPair('new');
  let published = [old.jwk];
  const server = jwksServer(() => published);
  const verify = jwtVerifier({ jwksUrl: JWKS_URL, issuer: ISSUER, fetch: server.fetch, now: () => now });

  assert.equal(await verify(await sign(old, { sub: USER }, now)), USER);
  published = [old.jwk, rotated.jwk];

  now = t0 + 1_000;
  assert.equal(await verify(await sign(rotated, { sub: USER }, now)), null, 'inside the cooldown: no refetch yet');
  assert.equal(server.fetches(), 1);

  now = t0 + JWKS_CACHE.cooldownMs + 1;
  assert.equal(await verify(await sign(rotated, { sub: USER }, now)), USER, 'past it: refetched, and the new key is there');
  assert.equal(server.fetches(), 2);

  const stranger = await keyPair('stranger');
  assert.equal(await verify(await sign(stranger, { sub: USER }, now)), null);
  assert.equal(server.fetches(), 2, 'the keys were just fetched, so an unknown key is simply refused');
});

test('the bearer token comes from the Authorization header only', () => {
  assert.equal(bearerToken(new Request('http://x', { headers: { authorization: 'Bearer abc.def.ghi' } })), 'abc.def.ghi');
  assert.equal(bearerToken(new Request('http://x', { headers: { authorization: 'Basic abc' } })), null);
  assert.equal(bearerToken(new Request('http://x?token=abc')), null);
  assert.equal(bearerToken(new Request('http://x', { headers: { authorization: 'Bearer ' } })), null);
});
