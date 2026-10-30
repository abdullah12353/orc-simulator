// Shared commit writers: the tick and create_world (day zero) write Facts, ticks rows and world state
// the same way. Everything is bulk-inserted through jsonb_array_elements (one statement per table).
import type { Content } from '@orc/content';
import {
  fallbackDialogue,
  type BlameEntry,
  type Cause,
  type Fact,
  type Fuse,
  type Humiliation,
  type StateDiff,
  type Trophy,
  type WorldState,
} from '@orc/sim';
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

  // Every Clash gets its fallback script now, in this transaction; narration upgrades it later.
  const dialogue = rows.flatMap(({ fact }) =>
    fact.kind === 'clash' ? [{ fact: fact.no, at: fact.at, key: fact.fallbackKey, lines: fallbackDialogue(content, fact) }] : [],
  );
  if (dialogue.length > 0) {
    await tx`
      insert into clash_dialogue (world_id, fact_no, lines, source, fallback_key, updated_at)
      select ${worldId}, (d->>'fact')::bigint, d->'lines', 'fallback', d->>'key', (d->>'at')::timestamptz
      from jsonb_array_elements(${jsonb(tx, dialogue)}) as d`;
    // The outbox: one narration job per Clash, drained after commit (narration/drain.ts).
    await tx`
      insert into narration_jobs (world_id, kind, fact_no, created_at)
      select ${worldId}, 'clash', (d->>'fact')::bigint, (d->>'at')::timestamptz
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

/** The Captain fields a tick can change so far (#32). Power, Infamy and Legendary arrive with #34. */
const CAPTAIN_FIELDS = new Set(['id', 'roster', 'epithet', 'aliasIdx', 'returnsAt', 'graceUntil', 'death']);

/**
 * Applies Captain patches (merged per Captain, in order). A death stamps `died_at` with `now` and records
 * the death Fact and cause tag; a Return (`death: null`) clears them.
 */
export async function updateCaptains(tx: Tx, worldId: string, patches: StateDiff['captains'], now: string): Promise<void> {
  if (patches.length === 0) return;
  const merged = new Map<string, Record<string, unknown>>();
  for (const p of patches) {
    const unknown = Object.keys(p).filter((k) => !CAPTAIN_FIELDS.has(k));
    if (unknown.length > 0) throw new Error(`commitDiff: unsupported Captain fields: ${unknown.join(', ')}`);
    merged.set(p.id, { ...merged.get(p.id), ...p });
  }
  await tx`
    update captains c set
      roster = case when p ? 'roster' then (p->>'roster')::roster else c.roster end,
      epithet = case when p ? 'epithet' then p->>'epithet' else c.epithet end,
      alias_idx = case when p ? 'aliasIdx' then (p->>'aliasIdx')::smallint else c.alias_idx end,
      returns_at = case when p ? 'returnsAt' then (p->>'returnsAt')::timestamptz else c.returns_at end,
      grace_until = case when p ? 'graceUntil' then (p->>'graceUntil')::timestamptz else c.grace_until end,
      death_fact = case when p ? 'death' then (p#>>'{death,cause,fact}')::bigint else c.death_fact end,
      death_cause_tag = case when p ? 'death' then p#>>'{death,causeTag}' else c.death_cause_tag end,
      died_at = case when p ? 'death' then case when jsonb_typeof(p->'death') = 'null' then null else ${now}::timestamptz end
                     else c.died_at end
    from jsonb_array_elements(${jsonb(tx, [...merged.values()])}) as p
    where c.world_id = ${worldId} and c.id = p->>'id'`;
}

/** Fears a Humiliation added (since `now`), and the oldest added Fear it replaced. */
export async function applyFears(tx: Tx, worldId: string, fears: StateDiff['fears'], now: string): Promise<void> {
  const removed = fears.filter((f) => f.remove !== undefined);
  const added = fears.filter((f) => f.add !== undefined);
  if (removed.length > 0) {
    await tx`
      delete from captain_fears cf using jsonb_array_elements(${jsonb(tx, removed)}) as f
      where cf.world_id = ${worldId} and cf.captain_id = f->>'captainId' and cf.fear = f->>'remove' and cf.added`;
  }
  if (added.length > 0) {
    await tx`
      insert into captain_fears (world_id, captain_id, fear, added, since)
      select ${worldId}, f->>'captainId', f->>'add', true, ${now}
      from jsonb_array_elements(${jsonb(tx, added)}) as f`;
  }
}

/**
 * Writes Humiliations, new or changed. When each was gained, and the Fact and time that ended it, are read
 * off `facts` (the batch that made them: one tick's, or all of day zero's). Ended rows stay as history.
 */
export async function upsertHumiliations(tx: Tx, worldId: string, humiliations: Humiliation[], facts: Fact[], now: string): Promise<void> {
  if (humiliations.length === 0) return;
  const at = new Map(facts.map((f) => [f.no, f.at]));
  const endedBy = new Map<number, Fact>();
  for (const f of facts) if (f.kind === 'humiliation_ended') endedBy.set(f.humiliation, f);
  const rows = humiliations.map((h) => {
    const ended = h.ended ? endedBy.get(h.no) : undefined;
    if (h.ended && !ended) throw new Error(`commit: Humiliation ${h.no} ended without a humiliation_ended Fact`);
    return {
      no: h.no,
      captainId: h.captainId,
      cat: h.cat,
      kind: h.key,
      gainedFact: h.gained.fact,
      gainedAt: at.get(h.gained.fact) ?? now,
      expiresAt: h.expiresAt,
      endedFact: ended?.no ?? null,
      endedAt: ended?.at ?? null,
    };
  });
  await tx`
    insert into humiliations (world_id, no, captain_id, cat, kind, gained_fact, gained_at, expires_at, ended_at, ended_fact)
    select ${worldId}, (h->>'no')::bigint, h->>'captainId', (h->>'cat')::humiliation_cat, h->>'kind',
           (h->>'gainedFact')::bigint, (h->>'gainedAt')::timestamptz, (h->>'expiresAt')::timestamptz,
           (h->>'endedAt')::timestamptz, (h->>'endedFact')::bigint
    from jsonb_array_elements(${jsonb(tx, rows)}) as h
    on conflict (world_id, no) do update set
      expires_at = excluded.expires_at, ended_at = excluded.ended_at, ended_fact = excluded.ended_fact`;
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
 * Writes a whole world's Captains (deaths and grace included), Fears, affinity, Grudge tags, Trophies,
 * Humiliations and reaction Fuses. Used once, by create_world, for the state day zero ends in (after its
 * Facts); ticks write changes through the diff. `history` adds the Humiliations day zero already ended,
 * and the Facts that say when.
 */
export async function insertWorldState(
  tx: Tx,
  worldId: string,
  state: WorldState,
  history: { humiliations: Humiliation[]; facts: Fact[] } = { humiliations: state.humiliations, facts: [] },
): Promise<void> {
  const captains = Object.values(state.captains).map((c) => ({
    id: c.id,
    roster: c.roster,
    power: c.power,
    infamy: c.infamy,
    traits: c.traits,
    epithet: c.epithet,
    aliasIdx: c.aliasIdx,
    returnsAt: c.returnsAt,
    graceUntil: c.graceUntil,
    deathFact: c.death?.cause.fact ?? null,
    deathCauseTag: c.death?.causeTag ?? null,
  }));
  await tx`
    insert into captains (world_id, id, roster, power, infamy, traits, epithet, alias_idx, returns_at, grace_until,
                          death_fact, death_cause_tag, died_at)
    select ${worldId}, c->>'id', (c->>'roster')::roster, (c->>'power')::smallint, (c->>'infamy')::int,
           array(select jsonb_array_elements_text(c->'traits')), c->>'epithet', (c->>'aliasIdx')::smallint,
           (c->>'returnsAt')::timestamptz, (c->>'graceUntil')::timestamptz, (c->>'deathFact')::bigint, c->>'deathCauseTag',
           (select f.at from facts f where f.world_id = ${worldId} and f.no = (c->>'deathFact')::bigint)
    from jsonb_array_elements(${jsonb(tx, captains)}) as c`;
  await upsertHumiliations(tx, worldId, history.humiliations, history.facts, state.world.now);

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
