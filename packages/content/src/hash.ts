// Pure, portable hashing (Node, Deno, browsers): no `crypto`, so the sim can use it too.

/** JSON with object keys sorted, so equal values always serialise identically. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (value === undefined) return 'null';
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

const encoder = new TextEncoder();
const hex4 = (n: number) => n.toString(16).padStart(4, '0');

/**
 * FNV-1a 64-bit over UTF-8, as 16 hex chars. The 64-bit state is kept in four 16-bit limbs (no BigInt):
 * the day-zero pre-roll hashes the state 288 times, and BigInt made that the slowest part of create_world.
 * Multiplying by the FNV prime 2^40 + 0x1b3 is `h * 0x1b3 + (h << 40)`.
 */
export function hashString(s: string): string {
  // offset basis 0xcbf29ce484222325
  let h0 = 0x2325;
  let h1 = 0x8422;
  let h2 = 0x9ce4;
  let h3 = 0xcbf2;
  for (const byte of encoder.encode(s)) {
    h0 ^= byte;
    const t0 = h0 * 0x1b3;
    const t1 = h1 * 0x1b3 + (t0 >>> 16);
    const t2 = h2 * 0x1b3 + (h0 << 8) + (t1 >>> 16);
    const t3 = h3 * 0x1b3 + (h1 << 8) + (t2 >>> 16);
    h0 = t0 & 0xffff;
    h1 = t1 & 0xffff;
    h2 = t2 & 0xffff;
    h3 = t3 & 0xffff;
  }
  return hex4(h3) + hex4(h2) + hex4(h1) + hex4(h0);
}

export function hashValue(value: unknown): string {
  return hashString(stableStringify(value));
}
