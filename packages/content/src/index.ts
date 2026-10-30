import { hashValue } from './hash.ts';
import type { Content } from './types.ts';

export * from './types.ts';
export { content } from './bundle.ts';
export { ACCENTS, ACCENT_LABELS, CASTING, FEARS, KRUG, TRAITS } from './pools.ts';
export { validateContent } from './validate.ts';
export { hashString, hashValue, stableStringify } from './hash.ts';

const versions = new WeakMap<Content, string>();

/**
 * The bundle's hash, recorded as `content_version` on worlds and ticks. Memoised per bundle object
 * (it hashes the whole bundle), so treat bundles as immutable: clone before editing one in a test.
 */
export function contentVersion(c: Content): string {
  let v = versions.get(c);
  if (v === undefined) {
    v = hashValue(c);
    versions.set(c, v);
  }
  return v;
}
