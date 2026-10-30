// Web Push on WebCrypto alone (runs the same in Node and Deno, no npm dependency): RFC 8291 message
// encryption (aes128gcm, RFC 8188) and RFC 8292 VAPID. The VAPID keys are secrets the operator sets
// (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`); without them nothing is ever sent.

export interface VapidKeys {
  /** Uncompressed P-256 point (65 bytes), base64url: what the PWA passes to `pushManager.subscribe`. */
  publicKey: string;
  /** The private scalar `d` (32 bytes), base64url. */
  privateKey: string;
  /** A `mailto:` or `https:` contact for the push services. */
  subject: string;
}

export interface PushSubscriptionKeys {
  /** The device's P-256 public key, base64url. */
  p256dh: string;
  /** The device's 16-byte auth secret, base64url. */
  auth: string;
}

/** Reads the VAPID secrets; null (pushes stay unsent) unless both keys are set. */
export function vapidFromEnv(get: (name: string) => string | undefined): VapidKeys | null {
  const publicKey = get('VAPID_PUBLIC_KEY')?.trim();
  const privateKey = get('VAPID_PRIVATE_KEY')?.trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: get('VAPID_SUBJECT')?.trim() || 'mailto:orc-nonsense@example.com' };
}

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

// The WebCrypto key types, without depending on the DOM lib (Node's and Deno's globals both fit).
type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
type KeyPair = { publicKey: Key; privateKey: Key };

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey('raw', concat(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, concat(data)));
}

/** HKDF (RFC 5869) with SHA-256, for outputs of at most 32 bytes (one block). */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length);
}

/** A P-256 private key from its raw scalar and public point (JWK needs both). */
function privateJwk(privateKey: string, publicKey: string) {
  const pub = fromB64url(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('webpush: a public key must be an uncompressed P-256 point');
  return { kty: 'EC', crv: 'P-256', d: privateKey, x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), ext: true };
}

const RECORD_SIZE = 4096;

/**
 * Encrypts one push message for a device (RFC 8291 §3–4: a single aes128gcm record). `fixed` pins the
 * salt and the server's ephemeral key pair, for RFC 8291's worked example; leave it out otherwise.
 */
export async function encryptPayload(
  sub: PushSubscriptionKeys,
  plaintext: Uint8Array,
  fixed?: { salt: Uint8Array; serverKeys: { publicKey: string; privateKey: string } },
): Promise<Uint8Array<ArrayBuffer>> {
  const ecdh = { name: 'ECDH', namedCurve: 'P-256' } as const;
  let asPrivate: Key;
  let asPublic: Uint8Array;
  if (fixed) {
    asPrivate = await crypto.subtle.importKey('jwk', privateJwk(fixed.serverKeys.privateKey, fixed.serverKeys.publicKey), ecdh, false, ['deriveBits']);
    asPublic = fromB64url(fixed.serverKeys.publicKey);
  } else {
    const pair = (await crypto.subtle.generateKey(ecdh, true, ['deriveBits'])) as KeyPair;
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  }
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const uaPublic = fromB64url(sub.p256dh);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, ecdh, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPrivate, 256));

  const keyInfo = concat(utf8('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(fromB64url(sub.auth), ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);

  // One record, so the padding delimiter is 0x02 (the last record).
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, new Uint8Array([2]))));

  const header = new Uint8Array(16 + 4 + 1);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

/** `Authorization: vapid t=<ES256 JWT>, k=<public key>` (RFC 8292), valid for 12 hours. */
export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, nowMs: number): Promise<string> {
  const enc = (v: unknown) => b64url(utf8(JSON.stringify(v)));
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({
    aud: new URL(endpoint).origin,
    exp: Math.floor(nowMs / 1000) + 12 * 3600,
    sub: vapid.subject,
  })}`;
  const key = await crypto.subtle.importKey('jwk', privateJwk(vapid.privateKey, vapid.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // WebCrypto's ECDSA signature is already r || s, which is what JWS wants.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(unsigned)));
  return `vapid t=${unsigned}.${b64url(sig)}, k=${vapid.publicKey}`;
}

export interface PushRequestOptions {
  fetch: typeof fetch;
  vapid: VapidKeys;
  nowMs: number;
  /** Seconds the push service may hold it for an offline device. */
  ttl: number;
  /** Replaces an undelivered push with the same topic. */
  topic?: string;
}

/** Sends one push to one device. Returns the push service's HTTP status (2xx = accepted). */
export async function sendPush(endpoint: string, sub: PushSubscriptionKeys, payload: string, opts: PushRequestOptions): Promise<number> {
  const body = await encryptPayload(sub, utf8(payload));
  const res = await opts.fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: await vapidAuthorization(endpoint, opts.vapid, opts.nowMs),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: String(opts.ttl),
      urgency: 'normal',
      ...(opts.topic ? { topic: opts.topic } : {}),
    },
    body,
  });
  await res.body?.cancel();
  return res.status;
}
