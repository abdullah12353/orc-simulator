// Shared commit writers: the tick and create_world (day zero) write Facts, ticks rows and world state
// the same way. Everything is bulk-inserted through jsonb_array_elements (one statement per table).
import type { Content } from '@orc/content';
import { fallbackDialogue, type BlameEntry, type Cause, type Fact, type Fuse, type Trophy, type WorldState } from '@orc/sim';
import { jsonb, type Tx } from './db.ts';

/**
 * All Facts in one statement (day zero inserts hundreds), with the full Fact kept as payload, plus their
 * causal edges, Blame, and every Clash's dialogue (its fallback script, data-model §3 step 6).
 */
export async function insertFacts(
  tx: Tx,
  worldId: string,
  rows: { tickSeq: number; fact: Fact }[],
  content: Content,
): Promise<void> {
  if (rows.length === 0) return;
  await tx`
    insert into facts (world_id, no, tick_seq, at, kind, story_no, template_id, variant, line, tier, "cast",
                       comedy_weight, payload)
    select ${worldId}, (f->>'no')::bigint, (r->>'tickSeq')::bigint, (f->>'at')::timestamptz, f->>'kind',
           (f->>'storyNo')::bigint, f->>'templateId', (f->>'variant')::smallint, f->>'line', (f->>'tier')::tier,
           array(select jsonb_array_elements_text(f->'cast')), (f->>'comedyWeight')::smallint, f
    from jsonb_array_elements(${jsonb(tx, rows)}) as r, lateral (select r->'fact' as f) as x`;

  // The causal edges and the materialised Blame (decision 9), straight from what the sim computed.
  const causes = rows.flatMap(({ fact }) => fact.causes.map((cause) => ({ fact: fact.no, cause })));
  if (causes.length > 0) {
    await tx`
      insert into fact_causes (world_id, fact_no, cause_no)
      select ${worldId}, (c->>'fact')::bigint, (c->>'cause')::bigint
      from jsonb_array_elements(${jsonb(tx, causes)}) as c`;
  }
  const blame = rows.flatMap(({ fact }) => fact.blame.map((b) => ({ ...b, fact: fact.no })));
  if (blame.length > 0) {
    await tx`
      insert into fact_blame (world_id, fact_no, meddle_id, player_id, verb, landed_fact, landed_at, hops)
      select ${worldId}, (b->>'fact')::bigint, (b->>'meddleId')::uuid, (b->>'playerId')::uuid,
             (b->>'verb')::meddle_verb, (b->>'landedFact')::bigint, (b->>'landedAt')::timestamptz, (b->>'hops')::smallint
      from jsonb_array_elements(${jsonb(tx, blame)}) as b`;
  }

  // Every Clash gets its fallback script now, in this transaction; narration (#37) upgrades it later.
  const dialogue = rows.flatMap(({ fact }) =>
    fact.kind === 'clash' ? [{ fact: fact.no, at: fact.at, key: fact.fallbackKey, lines: fallbackDialogue(content, fact) }] : [],
  );
  if (dialogue.length > 0) {
    await tx`
      insert into clash_dialogue (world_id, fact_no, lines, source, fallback_key, updated_at)
      select ${worldId}, (d->>'fact')::bigint, d->'lines', 'fallback', d->>'key', (d->>'at')::timestamptz
      from jsonb_array_elements(${jsonb(tx, dialogue)}) as d`;
  }
}

/** Puts Trophies in their (new) holders' hands. Current holder only: the history is in the log (D15). */
export async function upsertTrophies(tx: Tx, worldId: string, trophies: Trophy[], at: string): Promise<void> {
  if (trophies.length === 0) return;
  await tx`
    insert into trophies (world_id, no, kind, holder_id, taken_from_id, origin_fact, acquired_at)
    select ${worldId}, (t->>'no')::bigint, t->>'key', t->>'holder', t->>'takenFrom', (t#>>'{origin,fact}')::bigint, ${at}
    from jsonb_array_elements(${jsonb(tx, trophies)}) as t
    on conflict (world_id, no) do update set
      holder_id = excluded.holder_id, taken_from_id = excluded.taken_from_id,
      origin_fact = excluded.origin_fact, acquired_at = excluded.acquired_at`;
}

/** Queues Fuses: a Meddle's, or a reaction that chained past 3 deep (with its cast and parent Fact). */
export async function insertFuses(tx: Tx, worldId: string, fuses: Fuse[], createdTick: number): Promise<void> {
  if (fuses.length === 0) return;
  await tx`
    insert into fuses (world_id, no, due_at, kind, meddle_id, template_id, "cast", parent_fact, created_tick)
    select ${worldId}, (f->>'no')::bigint, (f->>'dueAt')::timestamptz,
           case when f ? 'reaction' then 'reaction' else 'meddle' end, (f->>'meddleId')::uuid,
           f#>>'{reaction,templateId}', f#>'{reaction,cast}', (f#>>'{reaction,parent,fact}')::bigint, ${createdTick}
    from jsonb_array_elements(${jsonb(tx, fuses)}) as f`;
}

/**
 * The Causes behind the given Facts, each with that Fact's Blame, for state that can cause later
 * events (Grudge tags now; Trophies, Humiliations and deaths later). Blame comes out in the sim's
 * canonical order (landing time, landing Fact, Meddle id), so a loaded Cause equals the one in memory.
 */
export async function loadCauses(tx: Tx, worldId: string, factNos: readonly number[]): Promise<Map<number, Cause>> {
  const causes = new Map<number, Cause>();
  const wanted = [...new Set(factNos)];
  for (const no of wanted) causes.set(no, { fact: no, blame: [] });
  if (wanted.length === 0) return causes;
  const rows = await tx<
    { fact_no: number; meddle_id: string; player_id: string; verb: BlameEntry['verb']; landed_fact: number; landed_at: string; hops: number }[]
  >`
    select fact_no::float8 as fact_no, meddle_id::text, player_id::text, verb::text, landed_fact::float8 as landed_fact,
           to_json(landed_at)#>>'{}' as landed_at, hops
    from fact_blame
    where world_id = ${worldId} and fact_no = any(${wanted}::bigint[])
    order by fact_no, landed_at, landed_fact, meddle_id`;
  for (const r of rows) {
    causes.get(r.fact_no)!.blame.push({
      meddleId: r.meddle_id,
      playerId: r.player_id,
      verb: r.verb,
      landedFact: r.landed_fact,
      landedAt: new Date(r.landed_at).toISOString(),
      hops: r.hops,
    });
  }
  return causes;
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
 * Writes a whole world's Captains, Fears, affinity, Grudge tags, Trophies and reaction Fuses. Used once,
 * by create_world, for the state day zero ends in (after its Facts); ticks write changes through the diff.
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

  await upsertTrophies(tx, worldId, state.trophies, state.world.now);
  await insertFuses(tx, worldId, state.fuses, state.world.tickSeq);
}
