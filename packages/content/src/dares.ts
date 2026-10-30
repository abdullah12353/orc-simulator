// The Dare picker's rules (#35, user stories 42–45), shared by the PWA (what to offer) and the sim (what a
// Dare intent may name). Pure: no randomness, so the same target and round always offer the same 3.
import { hashString } from './hash.ts';
import type { BankKey, Content, DareDef } from './types.ts';

/** The picker's fourth option: the sim picks a Dare that fits the target when it lands. */
export const SURPRISE = 'surprise';

/** How many Dares the picker offers at a time. */
export const DARE_OFFERS = 3;

/** Can this Captain be Dared into it? Only a Trait the Dare `needs` can rule him out. */
export function dareFits(def: DareDef, target: { traits: readonly string[] }): boolean {
  return def.needs === undefined || target.traits.includes(def.needs);
}

/** Does the Dare play on one of his Fears? */
export function playsOnFear(def: DareDef, fears: readonly string[]): boolean {
  return def.tags.some((t) => fears.includes(t));
}

/** Every Dare that fits him, by key. */
export function daresFor(content: Content, target: { traits: readonly string[] }): BankKey[] {
  return Object.keys(content.banks.dares)
    .sort()
    .filter((k) => dareFits(content.banks.dares[k]!, target));
}

/**
 * The 3 Dares the picker offers for `target` in `round` (0 first; "show me others" asks for the next round).
 * Always at least one Stunt and one Prank when he fits both; the rest by a hash of target, round and key.
 */
export function dareOffers(
  content: Content,
  target: { id: string; traits: readonly string[] },
  round = 0,
): BankKey[] {
  const ranked = daresFor(content, target)
    .map((k) => ({ k, h: hashString(`${target.id}:${round}:${k}`) }))
    .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
    .map((x) => x.k);
  const kind = (k: BankKey) => content.banks.dares[k]!.kind;
  const picked = new Set<BankKey>();
  for (const want of ['stunt', 'prank'] as const) {
    const first = ranked.find((k) => kind(k) === want);
    if (first) picked.add(first);
  }
  for (const k of ranked) {
    if (picked.size >= DARE_OFFERS) break;
    picked.add(k);
  }
  return ranked.filter((k) => picked.has(k)).slice(0, DARE_OFFERS);
}
