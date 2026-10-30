import type { Content } from '@orc/content';
import { castWorld } from './cast.ts';
import { tickSeed } from './rng.ts';
import { simulate } from './simulate.ts';
import { applyDiff, stateHash } from './state.ts';
import { addMinutes } from './time.ts';
import type { Fact, GrudgeTag, Humiliation, Iso, PlayerId, WorldState } from './types.ts';

/** The day-zero pre-roll (D57): about one simulated day of unwatched 5-minute ticks. */
export const DAY_ZERO = { steps: 288, minutes: 5 } as const;

export interface DayZeroStep {
  tickSeq: number;
  at: Iso;
  seed: number;
  facts: Fact[];
  /** Hash of the state after this step, as the tick records it. */
  stateHash: string;
}

/**
 * Casts a world at `createdAt − 24 h` and steps it in memory, `simulate` → `applyDiff`, through
 * DAY_ZERO.steps unwatched ticks, the last one landing on `createdAt`. Each step is exactly what the
 * tick would do (tick_seq 1, 2, …, seed = tickSeed(worldSeed, tickSeq)), so the world carries on
 * from day zero as if it had been ticking all along. `create_world` commits the result once.
 * `grudgeTags` is every tag day zero made (Grudge tags are permanent; the state keeps only the newest 3 a pair).
 * `humiliations` is every Humiliation it made, as it last stood, ended ones included (the DB keeps them as history).
 */
export function dayZero(
  content: Content,
  worldSeed: number,
  createdAt: Iso,
  worldId: string,
  players: PlayerId[] = [],
): { state: WorldState; steps: DayZeroStep[]; grudgeTags: GrudgeTag[]; humiliations: Humiliation[] } {
  const start = addMinutes(createdAt, -DAY_ZERO.steps * DAY_ZERO.minutes);
  const cast = castWorld(content, worldSeed, start, players);
  let state: WorldState = { ...cast, world: { ...cast.world, id: worldId } };
  const steps: DayZeroStep[] = [];
  const grudgeTags = [...state.grudgeTags];
  const humiliations = new Map<number, Humiliation>(state.humiliations.map((h) => [h.no, h]));

  for (let i = 0; i < DAY_ZERO.steps; i++) {
    const tickSeq = state.world.tickSeq + 1;
    const seed = tickSeed(worldSeed, tickSeq);
    const input: WorldState = {
      ...state,
      world: {
        ...state.world,
        tickSeq,
        prevTickAt: state.world.now,
        now: addMinutes(state.world.now, DAY_ZERO.minutes),
        watched: false,
      },
    };
    const { facts, stateDiff } = simulate(input, [], seed);
    state = applyDiff(input, stateDiff);
    grudgeTags.push(...stateDiff.grudgeTags);
    for (const h of stateDiff.humiliations.upsert) humiliations.set(h.no, h);
    steps.push({ tickSeq, at: state.world.now, seed, facts, stateHash: stateHash(state) });
  }
  return { state, steps, grudgeTags, humiliations: [...humiliations.values()].sort((a, b) => a.no - b.no) };
}
