// create_world: the signed-in caller founds a world and becomes its first Player. Casting is TS (the
// sim's castWorld), so this is an Edge Function rather than a plpgsql RPC. Day zero (D57) runs inside
// the same transaction: cast at created_at − 24 h, step the world in memory through about 288 unwatched
// ticks, then commit the cast, the day's Facts and its ticks rows once.
import { content as shippedContent, type Content } from '@orc/content';
import { dayZero } from '@orc/sim';
import { insertFacts, insertTicks, insertWorldState } from './commit.ts';
import type { Sql } from './db.ts';

export interface CreateWorldDeps {
  sql: Sql;
  now: () => Date;
  /** Source of the world seed (an unsigned 32-bit int). Random in production, fixed in tests. */
  randomSeed: () => number;
  content?: Content;
}

export interface CreateWorldInput {
  userId: string;
  name: string;
  displayName: string;
}

export class CreateWorldError extends Error {}

export async function createWorld(
  deps: CreateWorldDeps,
  input: CreateWorldInput,
): Promise<{ worldId: string; playerId: string }> {
  const name = input.name.trim();
  const displayName = input.displayName.trim();
  if (name.length < 1 || name.length > 60) throw new CreateWorldError('The world needs a name of 1–60 characters.');
  if (displayName.length < 1 || displayName.length > 40) {
    throw new CreateWorldError('Your display name needs 1–40 characters.');
  }

  const content = deps.content ?? shippedContent;
  const now = deps.now().toISOString();
  const seed = deps.randomSeed() >>> 0;

  return deps.sql.begin(async (tx) => {
    // The world row first (warlord_id stays null until casting), so day zero knows the world's id.
    const [world] = await tx<{ id: string }[]>`
      insert into worlds (name, seed, tick_seq, last_tick_at, next_no, warlord_id, day, deaths_today, content_version, created_at)
      values (${name}, ${seed}, 0, ${now}, 1, null, (${now}::timestamptz at time zone 'Europe/London')::date, 0, '', ${now})
      returning id`;
    const worldId = world!.id;
    const [player] = await tx<{ id: string }[]>`
      insert into players (world_id, user_id, display_name, joined_at)
      values (${worldId}, ${input.userId}, ${displayName}, ${now})
      returning id`;
    const playerId = player!.id;

    const started = performance.now();
    const { state, steps } = dayZero(content, seed, now, worldId);
    const cpuMs = Math.round((performance.now() - started) / steps.length);

    await insertWorldState(tx, worldId, state);
    await insertFacts(
      tx,
      worldId,
      steps.flatMap((s) => s.facts.map((fact) => ({ tickSeq: s.tickSeq, fact }))),
    );
    await insertTicks(
      tx,
      worldId,
      steps.map((s) => ({
        seq: s.tickSeq,
        at: s.at,
        seed: s.seed,
        watched: false,
        contentVersion: state.world.contentVersion,
        factCount: s.facts.length,
        cpuMs,
        stateHash: s.stateHash,
      })),
    );
    await tx`
      update worlds set
        created_by = ${playerId}, tick_seq = ${state.world.tickSeq}, last_tick_at = ${state.world.now},
        next_no = ${state.world.nextNo}, warlord_id = ${state.world.warlordId}, day = ${state.world.day},
        deaths_today = ${state.world.deathsToday}, content_version = ${state.world.contentVersion}
      where id = ${worldId}`;

    return { worldId, playerId };
  });
}
