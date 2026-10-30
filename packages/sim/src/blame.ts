// Blame chains (data-model §2, decisions 8 and 9). A Fact's causes are only the Facts whose state its
// Template REQUIRED; its Blame is every cause's Blame one hop further on, plus its own Meddle at hop 0,
// deduped per Meddle (the nearest path wins) and cut off past the hop cap. Callbacks add comedy weight
// but never Blame. The sim materialises Blame on every Fact, so the DB never has to recurse.
import { compareCodeUnits } from '@orc/content';
import { isoToMs } from './time.ts';
import type { BlameEntry, Cause, Fact, FactNo, GrudgeTag, Iso } from './types.ts';

/** A Fact as a cause: requiring it carries its Blame one hop on. */
export const causeOf = (f: Fact): Cause => ({ fact: f.no, blame: f.blame });

/** Decision 8: (a) required state only, (b) a pair's last 3 Grudge tags from 7 days, (c) at most 6 hops. */
export const BLAME = {
  hopCap: 6,
  pairWindowDays: 7,
  pairMaxTags: 3,
} as const;

/** The canonical order of a Blame set: by landing time, then landing Fact, then Meddle id. */
function byLanding(a: BlameEntry, b: BlameEntry): number {
  return (
    isoToMs(a.landedAt) - isoToMs(b.landedAt) ||
    a.landedFact - b.landedFact ||
    compareCodeUnits(a.meddleId, b.meddleId)
  );
}

/**
 * dedupe(every cause's Blame with hops + 1) ∪ the Fact's own Meddle (hop 0), past the hop cap dropped.
 * A Meddle reached by several paths keeps its smallest hop count.
 */
export function mergeBlame(causes: readonly Cause[], own: readonly BlameEntry[] = []): BlameEntry[] {
  const best = new Map<string, BlameEntry>();
  const offer = (e: BlameEntry) => {
    if (e.hops > BLAME.hopCap) return;
    const seen = best.get(e.meddleId);
    if (!seen || e.hops < seen.hops) best.set(e.meddleId, e);
  };
  for (const e of own) offer({ ...e, hops: 0 });
  for (const c of causes) for (const e of c.blame) offer({ ...e, hops: e.hops + 1 });
  return [...best.values()].sort(byLanding);
}

export interface Links {
  /** State the Template required: these become `fact.causes` and carry Blame. */
  requires?: readonly Cause[];
  /** State the Fact merely calls back to: comedy weight only, never a cause, never Blame. */
  callbacks?: readonly unknown[];
  /** The Fact's own Meddle, if it is a Meddle landing (hop 0). */
  own?: readonly BlameEntry[];
}

/** A Fact's `causes` and `blame` from what it required, plus how many Callbacks it made. */
export function chain(links: Links): { causes: FactNo[]; blame: BlameEntry[]; callbacks: number } {
  const requires = links.requires ?? [];
  return {
    causes: [...new Set(requires.map((c) => c.fact))].sort((a, b) => a - b),
    blame: mergeBlame(requires, links.own),
    callbacks: links.callbacks?.length ?? 0,
  };
}

/**
 * Decision 8(b): the causes behind an aggregate like a pair's affinity are that pair's Grudge tags from
 * the last 7 days, the newest 3. Old history seeded at casting has no cause, so it carries no Blame.
 */
export function pairCauses(tags: readonly GrudgeTag[], holder: string, toward: string, now: Iso): Cause[] {
  const since = isoToMs(now) - BLAME.pairWindowDays * 24 * 60 * 60_000;
  return tags
    .filter((t) => t.holder === holder && t.toward === toward && isoToMs(t.at) > since)
    .sort((a, b) => b.no - a.no)
    .slice(0, BLAME.pairMaxTags)
    .flatMap((t) => (t.cause ? [t.cause] : []));
}
