// The tick (data-model §3, steps 2, 3, 5 and 6): lock the world, load its state, simulate one step and
// commit Facts, the diff and the ticks row in ONE transaction. Any error rolls everything back, and the
// retry reuses the same tick_seq, so it gets the same seed and the same result.
import { content as shippedContent, contentVersion, type Content } from '@orc/content';
import {
  applyDiff,
  simulate,
  stateHash,
  tickSeed,
  type CaptainState,
  type Fact,
  type StateDiff,
  type WorldState,
} from '@orc/sim';
import { isLockNotAvailable, jsonb, type Sql, type Tx } from './db.ts';

/** Points between commit statements where a test can inject a failure (or a pause). */
export type CommitStep = 'locked' | 'facts' | 'world' | 'tick';

export interface TickDeps {
  sql: Sql;
  /** Injected clock: the only source of "now" for the tick. */
  now: () => Date;
  content?: Content;
  /** Test hook, awaited after each commit step. Throwing aborts (and rolls back) the tick. */
  onCommitStep?: (step: CommitStep, info: { tickSeq: number; stateHash?: string }) => void | Promise<void>;
}

export type TickOutcome =
  | { status: 'stepped'; worldId: string; tickSeq: number; factCount: number; stateHash: string }
  | { status: 'busy'; worldId: string }
  | { status: 'not_found'; worldId: string };

interface WorldRow {
  id: string;
  seed: number;
  tick_seq: number;
  last_tick_at: string;
  next_no: number;
  warlord_id: string | null;
  day: string;
  deaths_today: number;
}

interface CaptainRow {
  id: string;
  roster: CaptainState['roster'];
  power: number;
  infamy: number;
  traits: string[];
  epithet: string | null;
  alias_idx: 0 | 1 | null;
  returns_at: string | null;
  grace_until: string | null;
  legendary_fact: number | null;
}

/** Ticks one world. Returns `busy` without stepping if another tick holds the world's row lock. */
export async function tickWorld(deps: TickDeps, worldId: string): Promise<TickOutcome> {
  const content = deps.content ?? shippedContent;
  try {
    return await deps.sql.begin(async (tx) => {
      const [world] = await tx<WorldRow[]>`
        select id, seed::float8 as seed, tick_seq::int, to_json(last_tick_at)#>>'{}' as last_tick_at,
               next_no::int, warlord_id, day::text, deaths_today
        from worlds where id = ${worldId}
        for update nowait`;
      if (!world) return { status: 'not_found', worldId } as const;

      const tickSeq = world.tick_seq + 1;
      await deps.onCommitStep?.('locked', { tickSeq });

      const now = deps.now().toISOString();
      const state = await loadState(tx, world, content, now, tickSeq);

      const started = performance.now();
      const { facts, stateDiff } = simulate(state, [], tickSeed(world.seed, tickSeq));
      const next = applyDiff(state, stateDiff);
      const hash = stateHash(next);
      const cpuMs = Math.round(performance.now() - started);
      const info = { tickSeq, stateHash: hash };

      await insertFacts(tx, worldId, tickSeq, facts);
      await deps.onCommitStep?.('facts', info);

      await commitDiff(tx, worldId, stateDiff);
      await tx`
        update worlds set tick_seq = ${tickSeq}, last_tick_at = ${now}, content_version = ${state.world.contentVersion}
        where id = ${worldId}`;
      await deps.onCommitStep?.('world', info);

      await tx`
        insert into ticks (world_id, seq, at, seed, watched, content_version, intent_ids, fact_count, cpu_ms, state_hash)
        values (${worldId}, ${tickSeq}, ${now}, ${tickSeed(world.seed, tickSeq)}, ${state.world.watched},
                ${state.world.contentVersion}, '{}', ${facts.length}, ${cpuMs}, ${hash})`;
      await deps.onCommitStep?.('tick', info);

      return { status: 'stepped', worldId, tickSeq, factCount: facts.length, stateHash: hash } as const;
    });
  } catch (e) {
    if (isLockNotAvailable(e)) return { status: 'busy', worldId };
    throw e;
  }
}

/** Ticks every world, one transaction each. One world failing doesn't stop the others. */
export async function tickAllWorlds(deps: TickDeps): Promise<(TickOutcome | { status: 'error'; worldId: string; error: string })[]> {
  const worlds = await deps.sql<{ id: string }[]>`select id from worlds order by created_at, id`;
  const outcomes = [];
  for (const { id } of worlds) {
    try {
      outcomes.push(await tickWorld(deps, id));
    } catch (e) {
      outcomes.push({ status: 'error' as const, worldId: id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return outcomes;
}

async function loadState(tx: Tx, world: WorldRow, content: Content, now: string, tickSeq: number): Promise<WorldState> {
  const captainRows = await tx<CaptainRow[]>`
    select id, roster, power, infamy, traits, epithet, alias_idx,
           to_json(returns_at)#>>'{}' as returns_at, to_json(grace_until)#>>'{}' as grace_until,
           legendary_fact::float8 as legendary_fact
    from captains where world_id = ${world.id} order by id`;

  const captains: Record<string, CaptainState> = {};
  for (const c of captainRows) {
    captains[c.id] = {
      id: c.id,
      roster: c.roster,
      power: c.power,
      infamy: c.infamy,
      traits: [c.traits[0]!, c.traits[1]!],
      fears: [], // captain_fears arrives with #26
      epithet: c.epithet,
      aliasIdx: c.alias_idx,
      returnsAt: c.returns_at && new Date(c.returns_at).toISOString(),
      graceUntil: c.grace_until && new Date(c.grace_until).toISOString(),
      death: null,
      legendaryFact: c.legendary_fact,
    };
  }

  return {
    world: {
      id: world.id,
      tickSeq,
      now,
      prevTickAt: new Date(world.last_tick_at).toISOString(),
      watched: false, // the watched check and cadence arrive with #31
      day: world.day,
      deathsToday: world.deaths_today,
      warlordId: world.warlord_id,
      nextNo: world.next_no,
      contentVersion: contentVersion(content),
    },
    content,
    captains,
    affinity: {},
    grudgeTags: [],
    trophies: [],
    humiliations: [],
    stakes: [],
    players: {},
    meddles: {},
    fuses: [],
    infamy7d: [],
    recent: { templates: {}, pairs: {} },
  };
}

/** All Facts in one statement (day zero inserts hundreds), with the full Fact kept as payload. */
async function insertFacts(tx: Tx, worldId: string, tickSeq: number, facts: Fact[]): Promise<void> {
  if (facts.length === 0) return;
  await tx`
    insert into facts (world_id, no, tick_seq, at, kind, story_no, template_id, variant, line, tier, "cast",
                       comedy_weight, payload)
    select ${worldId}, (f->>'no')::bigint, ${tickSeq}, (f->>'at')::timestamptz, f->>'kind',
           (f->>'storyNo')::bigint, f->>'templateId', (f->>'variant')::smallint, f->>'line', (f->>'tier')::tier,
           array(select jsonb_array_elements_text(f->'cast')), (f->>'comedyWeight')::smallint, f
    from jsonb_array_elements(${jsonb(tx, facts)}) as f`;
}

/**
 * Writes a StateDiff to the tables. Extend this alongside the sim: a diff section the commit can't
 * write must fail loudly, never be dropped (applyDiff guards the same list in memory).
 */
async function commitDiff(tx: Tx, worldId: string, diff: StateDiff): Promise<void> {
  if (diff.captains.length > 0) throw new Error('commitDiff: captain patches are not committed yet');
  const w = diff.world;
  if (Object.keys(w).length === 0) return;
  await tx`
    update worlds set
      next_no = coalesce(${w.nextNo ?? null}::bigint, next_no),
      deaths_today = coalesce(${w.deathsToday ?? null}::smallint, deaths_today),
      day = coalesce(${w.day ?? null}::date, day),
      warlord_id = case when ${'warlordId' in w} then ${w.warlordId ?? null}::text else warlord_id end
    where id = ${worldId}`;
}
