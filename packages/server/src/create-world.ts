// create_world: the signed-in caller founds a world and becomes its first Player. Casting is TS (the
// sim's castWorld), so this is an Edge Function rather than a plpgsql RPC. #26 adds the day-zero pre-roll.
import { content as shippedContent, type Content } from '@orc/content';
import { castWorld } from '@orc/sim';
import { jsonb, type Sql } from './db.ts';

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
  const state = castWorld(content, seed, now, []);

  return deps.sql.begin(async (tx) => {
    const [world] = await tx<{ id: string }[]>`
      insert into worlds (name, seed, tick_seq, last_tick_at, next_no, warlord_id, day, deaths_today, content_version, created_at)
      values (${name}, ${seed}, ${state.world.tickSeq}, ${now}, ${state.world.nextNo}, ${state.world.warlordId},
              ${state.world.day}, ${state.world.deathsToday}, ${state.world.contentVersion}, ${now})
      returning id`;
    const worldId = world!.id;
    const [player] = await tx<{ id: string }[]>`
      insert into players (world_id, user_id, display_name, joined_at)
      values (${worldId}, ${input.userId}, ${displayName}, ${now})
      returning id`;
    const playerId = player!.id;
    await tx`update worlds set created_by = ${playerId} where id = ${worldId}`;

    const captains = Object.values(state.captains).map((c) => ({
      id: c.id,
      roster: c.roster,
      power: c.power,
      infamy: c.infamy,
      traits: c.traits,
    }));
    await tx`
      insert into captains (world_id, id, roster, power, infamy, traits)
      select ${worldId}, c->>'id', (c->>'roster')::roster, (c->>'power')::smallint, (c->>'infamy')::int,
             array(select jsonb_array_elements_text(c->'traits'))
      from jsonb_array_elements(${jsonb(tx, captains)}) as c`;

    return { worldId, playerId };
  });
}
