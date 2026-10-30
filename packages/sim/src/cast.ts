import { ACCENTS, CASTING, KRUG, contentVersion, type CastCard, type Content } from '@orc/content';
import { createRng, type Rng } from './rng.ts';
import { londonDate } from './time.ts';
import type { CaptainId, CaptainState, GrudgeTag, Iso, PlayerId, WorldState } from './types.ts';

/** What every new Player starts with (Backing economy #8, Meddle verbs #7). */
export const STARTING = { gold: 30, meddles: 3 } as const;

/** How many random draws of the active 12 casting compares to spread the Traits out. */
const CAST_DRAWS = 24;
/** Seeded Grudges start below −50, so a Clash can start on day one (D48): −55..−90. */
const SEEDED_AFFINITY = { min: 55, spread: 36 } as const;

const bySlug = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Casts a new world (D57). The active 12 are Krúg plus 2 per accent archetype (drawn so the Traits
 * are spread out); everyone else is in reserve. The highest-Power active Captain is the first Warlord
 * (never Krúg), and about 6 Grudges are seeded between active pairs from the old-history bank.
 * Pure and seeded: the same inputs always cast the same world.
 */
export function castWorld(content: Content, seed: number, now: Iso, players: PlayerId[]): WorldState {
  const rng = createRng(seed);
  const cards = [...content.cast].sort(bySlug);
  const activeIds = drawActive(cards, rng);

  const captains: Record<CaptainId, CaptainState> = {};
  for (const card of cards) {
    captains[card.id] = {
      id: card.id,
      roster: activeIds.has(card.id) ? 'active' : 'reserve',
      power: card.power,
      infamy: 0,
      traits: [card.traits[0], card.traits[1]],
      fears: card.fears.map((fear) => ({ fear, added: false, since: now })),
      epithet: card.epithet ?? null,
      aliasIdx: null,
      returnsAt: null,
      graceUntil: null,
      death: null,
      legendaryFact: null,
    };
  }

  const active = Object.values(captains).filter((c) => c.roster === 'active');
  // Ties: lifetime Infamy (all 0 at casting), then slug (data-model decision 16).
  const warlord = active.filter((c) => c.id !== KRUG).sort((a, b) => b.power - a.power || bySlug(a, b))[0];

  const { grudgeTags, affinity } = seedGrudges(content, active.map((c) => c.id).sort(), now, rng);

  return {
    world: {
      id: '',
      tickSeq: 0,
      now,
      prevTickAt: now,
      watched: false,
      day: londonDate(now),
      deathsToday: 0,
      warlordId: warlord?.id ?? null,
      nextNo: grudgeTags.length + 1,
      contentVersion: contentVersion(content),
    },
    content,
    captains,
    affinity,
    grudgeTags,
    trophies: [],
    humiliations: [],
    stakes: [],
    players: Object.fromEntries(
      [...players]
        .sort()
        .map((id) => [id, { gold: STARTING.gold, meddles: STARTING.meddles, firstMeddleDone: false, renderedFor: [] }]),
    ),
    meddles: {},
    fuses: [],
    infamy7d: [],
    recent: { templates: {}, pairs: {} },
  };
}

/** Draws several candidate active 12s and keeps the one whose Traits are most spread out (#20). */
function drawActive(cards: CastCard[], rng: Rng): Set<CaptainId> {
  let best: { ids: CaptainId[]; distinct: number; worst: number } | null = null;
  for (let i = 0; i < CAST_DRAWS; i++) {
    const ids: CaptainId[] = [];
    for (const accent of ACCENTS) {
      const pool = cards.filter((c) => c.accent === accent && c.id !== KRUG).map((c) => c.id);
      const need = CASTING.activePerAccent - (accent === 'cockney' ? 1 : 0);
      if (accent === 'cockney') ids.push(KRUG);
      for (let k = 0; k < need; k++) ids.push(pool.splice(rng.int(pool.length), 1)[0]!);
    }
    const counts = new Map<string, number>();
    for (const id of ids) {
      for (const t of cards.find((c) => c.id === id)!.traits) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const distinct = counts.size;
    const worst = Math.max(...counts.values());
    // Fewest Captains sharing one Trait first, then the most distinct Traits; the first best draw wins.
    if (!best || worst < best.worst || (worst === best.worst && distinct > best.distinct)) {
      best = { ids, distinct, worst };
    }
  }
  return new Set(best!.ids);
}

/** About 6 one-way Grudges between distinct active pairs, each with its own old-history tag. */
function seedGrudges(
  content: Content,
  active: CaptainId[],
  now: Iso,
  rng: Rng,
): { grudgeTags: GrudgeTag[]; affinity: WorldState['affinity'] } {
  const { min, max } = CASTING.seededGrudges;
  const count = min + rng.int(max - min + 1);
  const tags = [...new Set(content.banks.oldHistory)];
  const grudgeTags: GrudgeTag[] = [];
  const affinity: WorldState['affinity'] = {};

  while (grudgeTags.length < count) {
    const holder = rng.pick(active);
    const toward = rng.pick(active);
    if (holder === toward || affinity[`${holder}>${toward}`] !== undefined) continue;
    const tag = tags.splice(rng.int(tags.length), 1)[0]!;
    affinity[`${holder}>${toward}`] = -(SEEDED_AFFINITY.min + rng.int(SEEDED_AFFINITY.spread));
    // Old history predates the log, so no Fact caused it and it carries no Blame.
    grudgeTags.push({ no: grudgeTags.length + 1, holder, toward, tag, at: now, cause: null });
  }
  return { grudgeTags, affinity };
}
