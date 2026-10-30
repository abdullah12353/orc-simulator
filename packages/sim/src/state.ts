import { contentVersion, hashValue, type Content } from '@orc/content';
import { londonDate } from './time.ts';
import type { CaptainState, Iso, PlayerId, StateDiff, WorldState } from './types.ts';

/**
 * Casts a new world (D57). Tracer-bullet form: every card is active and the highest Power
 * (never Krúg) is Warlord. #26 brings the real casting rules and seeded Grudges.
 */
export function castWorld(content: Content, seed: number, now: Iso, players: PlayerId[]): WorldState {
  void seed;
  const captains: Record<string, CaptainState> = {};
  for (const card of [...content.cast].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    captains[card.id] = {
      id: card.id,
      roster: 'active',
      power: card.power,
      infamy: 0,
      traits: [...card.traits],
      fears: card.fears.map((fear) => ({ fear, added: false, since: now })),
      epithet: null,
      aliasIdx: null,
      returnsAt: null,
      graceUntil: null,
      death: null,
      legendaryFact: null,
    };
  }
  const warlord = Object.values(captains)
    .filter((c) => c.id !== 'krug')
    .sort((a, b) => b.power - a.power || (a.id < b.id ? -1 : 1))[0];

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
      nextNo: 1,
      contentVersion: contentVersion(content),
    },
    content,
    captains,
    affinity: {},
    grudgeTags: [],
    trophies: [],
    humiliations: [],
    stakes: [],
    players: Object.fromEntries(
      players.map((id) => [id, { gold: 0, meddles: 0, firstMeddleDone: false, renderedFor: [] }]),
    ),
    meddles: {},
    fuses: [],
    infamy7d: [],
    recent: { templates: {}, pairs: {} },
  };
}

/** Diff sections applyDiff (and the tick's commit) can apply so far. Others must stay empty. */
function assertSupported(diff: StateDiff): void {
  const unsupported: string[] = [];
  const nonEmpty = (name: string, list: unknown[]) => list.length > 0 && unsupported.push(name);
  nonEmpty('affinity', diff.affinity);
  nonEmpty('grudgeTags', diff.grudgeTags);
  nonEmpty('trophies', diff.trophies.upsert);
  nonEmpty('fears', diff.fears);
  nonEmpty('humiliations', diff.humiliations.upsert);
  nonEmpty('meddles', diff.meddles);
  nonEmpty('newMeddles', diff.newMeddles);
  nonEmpty('fuses', [...diff.fuses.add, ...diff.fuses.remove]);
  nonEmpty('stakes', diff.stakes);
  nonEmpty('ledger', diff.ledger);
  nonEmpty('playerDeltas', diff.playerDeltas);
  nonEmpty('intents', diff.intents);
  if (unsupported.length > 0) throw new Error(`applyDiff: unsupported diff sections: ${unsupported.join(', ')}`);
}

/** Applies a diff to a state, purely. Used for day zero and tests; the tick commits the same diff to SQL. */
export function applyDiff(state: WorldState, diff: StateDiff): WorldState {
  assertSupported(diff);
  const captains = { ...state.captains };
  for (const patch of diff.captains) {
    const current = captains[patch.id];
    if (!current) throw new Error(`applyDiff: unknown Captain ${patch.id}`);
    captains[patch.id] = { ...current, ...patch };
  }
  return { ...state, world: { ...state.world, ...diff.world }, captains };
}

/** A hash of everything in the state except the content bundle (represented by its version). */
export function stateHash(state: WorldState): string {
  return hashValue({ ...state, content: undefined });
}
