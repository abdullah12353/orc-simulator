// Seam A helpers: build a small world from the content bundle and step it in memory.
import { content as shippedContent, type Content } from '@orc/content';
import { applyDiff, castWorld, simulate, tickSeed, type Fact, type WorldState } from '@orc/sim';

export const T0 = '2026-10-30T12:00:00.000Z';
export const WORLD_SEED = 0x5eed;

/** How many seeds multi-seed runs use. Small locally; CI raises it (ORC_SEEDS=500). */
export const SEEDS = Number(process.env.ORC_SEEDS ?? 20);

export function freshWorld(opts: { seed?: number; now?: string; content?: Content; watched?: boolean } = {}): WorldState {
  const state = castWorld(opts.content ?? shippedContent, opts.seed ?? WORLD_SEED, opts.now ?? T0, []);
  return { ...state, world: { ...state.world, watched: opts.watched ?? false } };
}

const addMinutes = (iso: string, m: number) => new Date(Date.parse(iso) + m * 60_000).toISOString();

/** What the tick does between steps: the next tick_seq, the clock moved on, then simulate + applyDiff. */
export function step(state: WorldState, worldSeed = WORLD_SEED, minutes = 5): { state: WorldState; facts: Fact[] } {
  const tickSeq = state.world.tickSeq + 1;
  const input: WorldState = {
    ...state,
    world: { ...state.world, tickSeq, prevTickAt: state.world.now, now: addMinutes(state.world.now, minutes) },
  };
  const { facts, stateDiff } = simulate(input, [], tickSeed(worldSeed, tickSeq));
  return { state: applyDiff(input, stateDiff), facts };
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
