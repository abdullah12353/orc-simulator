import { hashValue } from './hash.ts';
import type { Content } from './types.ts';

export * from './types.ts';
export { content } from './bundle.ts';
export { validateContent } from './validate.ts';
export { hashString, hashValue, stableStringify } from './hash.ts';

/** The bundle's hash, recorded as `content_version` on worlds and ticks. */
export function contentVersion(c: Content): string {
  return hashValue(c);
}
