// Shared commit writers: the tick and create_world (day zero) write Facts, ticks rows and world state
// the same way. Everything is bulk-inserted through jsonb_array_elements (one statement per table).
import type { Fact, WorldState } from '@orc/sim';
import { jsonb, type Tx } from './db.ts';

/** All Facts in one statement (day zero inserts hundreds), with the full Fact kept as payload. */
export async function insertFacts(tx: Tx, worldId: string, rows: { tickSeq: number; fact: Fact }[]): Promise<void> {
  if (rows.length === 0) return;
  await tx`
    insert into facts (world_id, no, tick_seq, at, kind, story_no, template_id, variant, line, tier, "cast",
                       comedy_weight, payload)
    select ${worldId}, (f->>'no')::bigint, (r->>'tickSeq')::bigint, (f->>'at')::timestamptz, f->>'kind',
           (f->>'storyNo')::bigint, f->>'templateId', (f->>'variant')::smallint, f->>'line', (f->>'tier')::tier,
           array(select jsonb_array_elements_text(f->'cast')), (f->>'comedyWeight')::smallint, f
    from jsonb_array_elements(${jsonb(tx, rows)}) as r, lateral (select r->'fact' as f) as x`;
}

export interface TickRow {
  seq: number;
  at: string;
  seed: number;
  watched: boolean;
  contentVersion: string;
  /** Intents this tick consumed or rejected. */
  intentIds?: string[];
  factCount: number;
  cpuMs: number;
  stateHash: string;
}

export async function insertTicks(tx: Tx, worldId: string, rows: TickRow[]): Promise<void> {
  if (rows.length === 0) return;
  await tx`
    insert into ticks (world_id, seq, at, seed, watched, content_version, intent_ids, fact_count, cpu_ms, state_hash)
    select ${worldId}, (t->>'seq')::bigint, (t->>'at')::timestamptz, (t->>'seed')::bigint, (t->>'watched')::boolean,
           t->>'contentVersion', array(select jsonb_array_elements_text(coalesce(t->'intentIds', '[]')))::uuid[],
           (t->>'factCount')::smallint, (t->>'cpuMs')::int, t->>'stateHash'
    from jsonb_array_elements(${jsonb(tx, rows)}) as t`;
}

/**
 * Writes a whole world's Captains, Fears, affinity and Grudge tags. Used once, by create_world, for
 * the state day zero ends in; ticks write changes through the diff instead.
 */
export async function insertWorldState(tx: Tx, worldId: string, state: WorldState): Promise<void> {
  const captains = Object.values(state.captains).map((c) => ({
    id: c.id,
    roster: c.roster,
    power: c.power,
    infamy: c.infamy,
    traits: c.traits,
    epithet: c.epithet,
    aliasIdx: c.aliasIdx,
  }));
  await tx`
    insert into captains (world_id, id, roster, power, infamy, traits, epithet, alias_idx)
    select ${worldId}, c->>'id', (c->>'roster')::roster, (c->>'power')::smallint, (c->>'infamy')::int,
           array(select jsonb_array_elements_text(c->'traits')), c->>'epithet', (c->>'aliasIdx')::smallint
    from jsonb_array_elements(${jsonb(tx, captains)}) as c`;

  const fears = Object.values(state.captains).flatMap((c) =>
    c.fears.map((f) => ({ captainId: c.id, fear: f.fear, added: f.added, since: f.since })),
  );
  if (fears.length > 0) {
    await tx`
      insert into captain_fears (world_id, captain_id, fear, added, since)
      select ${worldId}, f->>'captainId', f->>'fear', (f->>'added')::boolean, (f->>'since')::timestamptz
      from jsonb_array_elements(${jsonb(tx, fears)}) as f`;
  }

  const affinity = Object.entries(state.affinity).map(([pair, value]) => {
    const [holder, toward] = pair.split('>');
    return { holder, toward, value };
  });
  if (affinity.length > 0) {
    await tx`
      insert into affinity (world_id, holder_id, toward_id, value, updated_at)
      select ${worldId}, a->>'holder', a->>'toward', (a->>'value')::smallint, ${state.world.now}
      from jsonb_array_elements(${jsonb(tx, affinity)}) as a`;
  }

  if (state.grudgeTags.length > 0) {
    await tx`
      insert into grudge_tags (world_id, no, holder_id, toward_id, tag, cause_fact, created_at)
      select ${worldId}, (g->>'no')::bigint, g->>'holder', g->>'toward', g->>'tag', (g#>>'{cause,fact}')::bigint,
             (g->>'at')::timestamptz
      from jsonb_array_elements(${jsonb(tx, state.grudgeTags)}) as g`;
  }
}
