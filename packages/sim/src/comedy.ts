// Comedy weight (D50): how funny a story is, computed by the sim on story heads only. It ranks the
// Herald and feeds the Hall of Shame's moments shelf (20+).
import { KRUG } from '@orc/content';
import type { Fact, WorldState } from './types.ts';

export interface ComedyInputs {
  /** The Template's base comedy weight. */
  base: number;
  /** Infamy gained across the story (the head and its consequences). */
  infamy: number;
  /** Callbacks the story made: reused Grudge tags, a Trophy changing hands again, a Fear already shown. */
  callbacks: number;
  /** The story carries Blame (a Meddle caused it, directly or down a chain). */
  meddleCaused: boolean;
  /** Krúg or the Warlord is in the cast. */
  krugOrWarlord: boolean;
}

/** D50: base + Infamy/3 (rounded down) + 3 per Callback + 2 if Meddle-caused + 2 if Krúg or the Warlord. */
export function comedyWeight(i: ComedyInputs): number {
  return i.base + Math.floor(i.infamy / 3) + 3 * i.callbacks + (i.meddleCaused ? 2 : 0) + (i.krugOrWarlord ? 2 : 0);
}

/**
 * Sets `comedyWeight` on every story head among `facts` and clears it on consequences. Run once per
 * tick, after the tick's Facts are complete, so Infamy from a head's consequences counts.
 * `callbacks` maps a Fact number to the Callbacks it made.
 */
export function weighStories(state: WorldState, facts: Fact[], callbacks: ReadonlyMap<number, number> = new Map()): void {
  const base = new Map(state.content.templates.map((t) => [t.id, t.baseWeight]));
  const stories = new Map<number, Fact[]>();
  for (const f of facts) stories.set(f.storyNo, [...(stories.get(f.storyNo) ?? []), f]);

  for (const f of facts) {
    if (f.no !== f.storyNo) {
      delete f.comedyWeight;
      continue;
    }
    const story = stories.get(f.no)!;
    f.comedyWeight = comedyWeight({
      base: (f.templateId && base.get(f.templateId)) || 0,
      infamy: story.reduce((sum, x) => sum + x.infamy.reduce((s, g) => s + g.amount, 0), 0),
      callbacks: story.reduce((sum, x) => sum + (callbacks.get(x.no) ?? 0), 0),
      meddleCaused: f.blame.length > 0,
      krugOrWarlord: f.cast.includes(KRUG) || (state.world.warlordId !== null && f.cast.includes(state.world.warlordId)),
    });
  }
}
