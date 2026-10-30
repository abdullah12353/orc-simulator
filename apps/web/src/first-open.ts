// First open and hints (#43, D58): no tutorial. A Player's very first open plays Krúg's Introduction,
// then their edition, then a guided first Rumour (the normal composer with suggested picks, on the 2–5 min
// Fuse). Dares, Backing and the Stable each get a one-line hint the first time the Player meets them.
// Pure, so it's tested in apps/web/test; the RPCs (begin_first_open, see_hint) are wired in first-open-data.ts.
import { KRUG, type Claim } from '@orc/content';

export type FirstOpenStep = 'introduction' | 'edition' | 'rumour';
const ORDER: FirstOpenStep[] = ['introduction', 'edition', 'rumour'];

/** The step after `done` (null = not started). `firstOpen` is begin_first_open's answer: false = no sequence. */
export function nextStep(firstOpen: boolean, done: FirstOpenStep | null): FirstOpenStep | null {
  if (!firstOpen) return null;
  return ORDER[done === null ? 0 : ORDER.indexOf(done) + 1] ?? null;
}

/**
 * What a device remembers of a first open that hasn't finished (per world and Player): the last step
 * done, or 'begun' for none yet. begin_first_open is true only once, so closing the app mid-way would
 * otherwise lose the rest for good.
 */
export type FirstOpenProgress = FirstOpenStep | 'begun';

/** Where a first open stands: begin_first_open's answer (`fresh`) and what the device remembers. */
export function resumeFirstOpen(fresh: boolean, saved: string | null): { running: boolean; done: FirstOpenStep | null } {
  if (fresh) return { running: true, done: null };
  if (saved === 'begun') return { running: true, done: null };
  const done = ORDER.find((s) => s === saved);
  if (!done || nextStep(true, done) === null) return { running: false, done: null };
  return { running: true, done };
}

/** What to remember once `done` is done (null = not started yet): null once nothing is left. */
export function progressAfter(done: FirstOpenStep | null): FirstOpenProgress | null {
  if (done === null) return 'begun';
  return nextStep(true, done) === null ? null : done;
}

export type Hint = 'dare' | 'backing' | 'stable';

export const HINTS: Record<Hint, string> = {
  dare: 'Dare a Captain to do something stupid. He might pull it off. He might not come back.',
  backing: 'Back a Captain with gold: you earn when he wins a Clash or does something infamous.',
  stable: 'Your Stable: your gold, your Stakes, and what your Meddles did. Nobody else sees it.',
};

export interface SuggestedRumour {
  source: string;
  target: string;
  claim: Claim;
  subject: { from: 'trait'; key: string };
}

interface PickableCaptain {
  id: string;
  roster: 'active' | 'reserve' | 'dead';
  traits: string[];
}

/**
 * The guided Rumour's suggested picks: Krúg (everyone believes Krúg) insulting the Warlord over one of
 * the Warlord's own Traits. Without a usable Warlord, the first other Captain by id; without Krúg as the
 * source, the first other Captain by id. Only active Captains. Null if there aren't two.
 */
export function suggestRumour(captains: PickableCaptain[], warlordId: string | null): SuggestedRumour | null {
  const active = captains.filter((c) => c.roster === 'active').sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const target = active.find((c) => c.id === warlordId && c.traits.length > 0) ?? active.find((c) => c.id !== KRUG && c.traits.length > 0);
  if (!target) return null;
  const source = active.find((c) => c.id === KRUG && c.id !== target.id) ?? active.find((c) => c.id !== target.id);
  if (!source) return null;
  return { source: source.id, target: target.id, claim: 'insult', subject: { from: 'trait', key: target.traits[0]! } };
}
