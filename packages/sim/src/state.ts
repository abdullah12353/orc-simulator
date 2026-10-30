import { hashValue } from '@orc/content';
import type { StateDiff, WorldState } from './types.ts';

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
