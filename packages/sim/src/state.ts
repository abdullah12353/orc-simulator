import { hashValue } from '@orc/content';
import { MEDDLE_CAP, VARIETY } from './context.ts';
import { isoToMs } from './time.ts';
import type { StateDiff, Trophy, WorldState } from './types.ts';

/** Diff sections applyDiff (and the tick's commit) can apply so far. Others must stay empty. */
function assertSupported(diff: StateDiff): void {
  const unsupported: string[] = [];
  const nonEmpty = (name: string, list: unknown[]) => list.length > 0 && unsupported.push(name);
  nonEmpty('fears', diff.fears);
  nonEmpty('humiliations', diff.humiliations.upsert);
  nonEmpty('stakes', diff.stakes);
  nonEmpty('ledger', diff.ledger);
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

  const affinity = { ...state.affinity };
  for (const a of diff.affinity) {
    if (a.value === 0) delete affinity[`${a.holder}>${a.toward}`];
    else affinity[`${a.holder}>${a.toward}`] = a.value;
  }

  const players = { ...state.players };
  for (const d of diff.playerDeltas) {
    const p = players[d.playerId];
    if (!p) throw new Error(`applyDiff: unknown Player ${d.playerId}`);
    players[d.playerId] = {
      ...p,
      meddles: Math.max(0, Math.min(MEDDLE_CAP, p.meddles + (d.meddles ?? 0))),
      ...(d.firstMeddleDone ? { firstMeddleDone: true } : {}),
    };
  }

  const meddles = { ...state.meddles };
  for (const m of diff.newMeddles) meddles[m.id] = m;
  for (const m of diff.meddles) {
    const current = meddles[m.id];
    if (!current) throw new Error(`applyDiff: unknown Meddle ${m.id}`);
    if (m.status === 'landed') delete meddles[m.id];
    else meddles[m.id] = { ...current, status: m.status, heldOn: m.heldOn ?? null };
  }

  const removed = new Set(diff.fuses.remove);
  const fuses = [...state.fuses.filter((f) => !removed.has(f.no)), ...diff.fuses.add];

  // Current holders only (D15), by number.
  const trophies = new Map<number, Trophy>(state.trophies.map((t) => [t.no, t]));
  for (const t of diff.trophies.upsert) trophies.set(t.no, t);

  const world = { ...state.world, ...diff.world };
  return {
    ...state,
    world,
    trophies: [...trophies.values()].sort((a, b) => a.no - b.no),
    recent: {
      templates: recentWithin({ ...state.recent.templates, ...diff.recent.templates }, world.now, VARIETY.templateHours),
      pairs: recentWithin({ ...state.recent.pairs, ...diff.recent.pairs }, world.now, VARIETY.pairHours),
    },
    captains,
    affinity,
    grudgeTags: [...state.grudgeTags, ...diff.grudgeTags],
    players,
    meddles,
    fuses,
  };
}

/** Keeps the entries inside the window ending at `now`, as the tick's loader does from `facts`. */
function recentWithin(entries: Record<string, string>, now: string, hours: number): Record<string, string> {
  const since = isoToMs(now) - hours * 3_600_000;
  return Object.fromEntries(Object.entries(entries).filter(([, at]) => isoToMs(at) > since));
}

/** A hash of everything in the state except the content bundle (represented by its version). */
export function stateHash(state: WorldState): string {
  return hashValue({ ...state, content: undefined });
}
