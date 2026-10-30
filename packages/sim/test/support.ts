// Seam A helpers: build a small world from the content bundle and step it in memory.
import { content as shippedContent, type Content } from '@orc/content';
import {
  applyDiff,
  castWorld,
  simulate,
  tickSeed,
  type CaptainId,
  type Claim,
  type Fact,
  type Intent,
  type StateDiff,
  type Subject,
  type WorldState,
} from '@orc/sim';

export const T0 = '2026-10-30T12:00:00.000Z';
export const WORLD_SEED = 0x5eed;

/** How many seeds multi-seed runs use. Small locally; CI raises it (ORC_SEEDS=500). */
export const SEEDS = Number(process.env.ORC_SEEDS ?? 20);

export function freshWorld(
  opts: { seed?: number; now?: string; content?: Content; watched?: boolean; players?: string[] } = {},
): WorldState {
  const state = castWorld(opts.content ?? shippedContent, opts.seed ?? WORLD_SEED, opts.now ?? T0, opts.players ?? []);
  return { ...state, world: { ...state.world, watched: opts.watched ?? false } };
}

export const addMinutes = (iso: string, m: number) => new Date(Date.parse(iso) + m * 60_000).toISOString();

/** What the tick does between steps: the next tick_seq, the clock moved on, then simulate + applyDiff. */
export function step(
  state: WorldState,
  worldSeed = WORLD_SEED,
  minutes = 5,
  intents: Intent[] = [],
): { state: WorldState; facts: Fact[]; diff: StateDiff } {
  const tickSeq = state.world.tickSeq + 1;
  const input: WorldState = {
    ...state,
    world: { ...state.world, tickSeq, prevTickAt: state.world.now, now: addMinutes(state.world.now, minutes) },
  };
  const { facts, stateDiff } = simulate(input, intents, tickSeed(worldSeed, tickSeq));
  return { state: applyDiff(input, stateDiff), facts, diff: stateDiff };
}

export function run(state: WorldState, steps: number, worldSeed = WORLD_SEED): { state: WorldState; facts: Fact[] } {
  const facts: Fact[] = [];
  for (let i = 0; i < steps; i++) {
    const r = step(state, worldSeed);
    state = r.state;
    facts.push(...r.facts);
  }
  return { state, facts };
}

/** Active Captains in slug order, optionally filtered. */
export function activeIds(state: WorldState, keep: (id: CaptainId) => boolean = () => true): CaptainId[] {
  return Object.keys(state.captains)
    .filter((id) => state.captains[id]!.roster === 'active' && keep(id))
    .sort();
}

let intentCounter = 0;

/** A Rumour intent about `target`, by default on his first Trait, as submitted by `playerId`. */
export function rumour(
  state: WorldState,
  playerId: string,
  r: { source: CaptainId; target: CaptainId; claim?: Claim; subject?: Subject; freeText?: string; firstMeddle?: boolean },
): Intent {
  intentCounter++;
  return {
    id: `00000000-0000-4000-8000-${String(intentCounter).padStart(12, '0')}`,
    playerId,
    at: state.world.now,
    kind: 'rumour',
    source: r.source,
    target: r.target,
    claim: r.claim ?? 'insult',
    subject: r.subject ?? { from: 'trait', key: state.captains[r.target]!.traits[0] },
    ...(r.freeText !== undefined ? { freeText: r.freeText } : {}),
    firstMeddle: r.firstMeddle ?? false,
  };
}
