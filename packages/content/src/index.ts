import { hashValue } from './hash.ts';
import type { Content } from './types.ts';

export * from './types.ts';
export { content } from './bundle.ts';
export { ACCENTS, ACCENT_LABELS, CASTING, CAUSE_TAGS, CLAIMS, FEARS, KRUG, PARENT_ROLES, TRAITS, type ParentKind } from './pools.ts';
export { subjectText, type SubjectRef } from './subjects.ts';
export { blameLine, type BlameName } from './blame-line.ts';
export { DARE_OFFERS, SURPRISE, dareFits, dareOffers, daresFor, playsOnFear } from './dares.ts';
export {
  BARK_EMOTIONS,
  STINGERS,
  barkPath,
  epithetPath,
  introShoutPath,
  introSignaturePath,
  stingerPath,
  type BarkEmotion,
  type Stinger,
} from './audio.ts';
export {
  composePortrait,
  marksAsOf,
  type HumiliationRow,
  LEGENDARY_LAYER,
  LEGENDARY_SLOT,
  OVERLAY_LIMIT,
  PORTRAIT_TEMPLATE,
  overlayPath,
  portraitPath,
  type ComposedPortrait,
  type LayerNudge,
  type PortraitLayer,
  type PortraitMark,
} from './portrait.ts';
export { validateContent, RUMOUR_TEMPLATES, DARE_TEMPLATES, ROSTER_TEMPLATES } from './validate.ts';
export { compareCodeUnits, hashString, hashValue, stableStringify } from './hash.ts';
export { TONE_BIBLE } from './tone-bible.ts';
export { FORBIDDEN_NAMES, SWEAR, allText, forbiddenNameIn, heraldText, swearIn } from './tone.ts';

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
