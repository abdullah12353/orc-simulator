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

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;
const encoder = new TextEncoder();

/** FNV-1a 64-bit over UTF-8, as 16 hex chars. */
export function hashString(s: string): string {
  let h = FNV_OFFSET;
  for (const byte of encoder.encode(s)) {
    h ^= BigInt(byte);
    h = (h * FNV_PRIME) & MASK64;
  }
  return h.toString(16).padStart(16, '0');
}

export function hashValue(value: unknown): string {
  return hashString(stableStringify(value));
}
