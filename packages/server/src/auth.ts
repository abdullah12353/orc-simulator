// Who is calling (#52 item 6): the Worker verifies the caller's Neon Auth JWT locally, against Neon
// Auth's JWKS (Ed25519, alg EdDSA), checking the signature, `iss` and `exp`. The keys are cached in the
// isolate's memory, so a request costs one signature check and no network call, well under the Worker's
// 20 ms of CPU. The verified `sub` is the user id the world's Durable Object trusts.
import { createLocalJWKSet, errors, jwtVerify, type JSONWebKeySet } from 'jose';

export const JWKS_CACHE = {
  /** Keys are refetched after this long, so a rotation is picked up without a redeploy. */
  maxAgeMs: 60 * 60_000,
  /** A token signed by a key we don't have refetches the keys, at most this often. */
  cooldownMs: 30_000,
} as const;

export interface JwtVerifierOptions {
  /** Neon Auth's `…/auth/.well-known/jwks.json`. */
  jwksUrl: string;
  /** The tokens' `iss`: the Neon Auth host's origin. */
  issuer: string;
  fetch?: typeof fetch;
  /** Injected clock (ms), for the cache and `exp`. */
  now?: () => number;
}

/** Verifies a token and returns its user id (`sub`), or null for anything that isn't a valid, current token. */
export type VerifyToken = (token: string) => Promise<string | null>;

export function jwtVerifier(opts: JwtVerifierOptions): VerifyToken {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  let cached: { keys: ReturnType<typeof createLocalJWKSet>; at: number } | null = null;

  async function keys(force: boolean) {
    const fresh = cached && now() - cached.at < (force ? JWKS_CACHE.cooldownMs : JWKS_CACHE.maxAgeMs);
    if (fresh) return cached!.keys;
    const res = await doFetch(opts.jwksUrl);
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    cached = { keys: createLocalJWKSet((await res.json()) as JSONWebKeySet), at: now() };
    return cached.keys;
  }

  async function verify(token: string, force: boolean): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, await keys(force), {
        issuer: opts.issuer,
        algorithms: ['EdDSA'], // what Neon Auth signs with (checked on orc-probe, #67)
        currentDate: new Date(now()),
        requiredClaims: ['sub', 'exp'],
      });
      return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
    } catch (e) {
      // A key we haven't seen (Neon rotated them): refetch once, then give up.
      if (e instanceof errors.JWKSNoMatchingKey && !force) return verify(token, true);
      if (e instanceof errors.JOSEError) return null;
      throw e;
    }
  }

  return (token) => verify(token, false);
}

/** The bearer token of a request (`Authorization: Bearer …`), or null. */
export function bearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization');
  return auth?.startsWith('Bearer ') ? auth.slice(7).trim() || null : null;
}
