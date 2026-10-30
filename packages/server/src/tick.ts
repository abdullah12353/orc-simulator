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
  type Claim,
  type Fuse,
  type GrudgeTag,
  type Intent,
  type Meddle,
  type StateDiff,
  type WorldState,
} from '@orc/sim';
import { insertFacts, insertFuses, insertTicks, loadCauses, upsertTrophies } from './commit.ts';
import { isLockNotAvailable, jsonb, type Sql, type Tx } from './db.ts';
import { broadcast } from './realtime.ts';

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
  /** Unwatched and inside the 5-minute cadence: nothing happened, the call only counted as activity. */
  | { status: 'idle'; worldId: string }
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

interface MeddleRow {
  id: string;
  player_id: string;
  verb: 'rumour' | 'dare';
  source_id: string | null;
  target_id: string;
  claim: Claim;
  subject: { from: 'trait' | 'fear' | 'trophy'; key: string } | null;
  free_text: string | null;
  status: 'pending' | 'held';
  held_on: string | null;
}

/** A Meddle row as the sim holds it: exactly what the sim stored (`firstMeddle` did its job at fusing). */
function toMeddle(m: MeddleRow): Meddle {
  if (m.verb !== 'rumour') throw new Error(`loadState: ${m.verb} Meddles are not loaded yet`);
  return {
    id: m.id,
    playerId: m.player_id,
    intent: {
      kind: 'rumour',
      source: m.source_id!,
      target: m.target_id,
      claim: m.claim,
      subject: { from: m.subject!.from, key: m.subject!.key },
      ...(m.free_text ? { freeText: m.free_text } : {}),
      firstMeddle: false,
    },
    status: m.status,
    heldOn: m.held_on,
  };
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
      // Cadence (D39): a watched world steps on every call (the clock calls once a minute); an
      // unwatched one only every 5 minutes. An idle call commits nothing.
      const watched = await isWatched(tx, worldId, now);
      if (!watched && Date.parse(now) - Date.parse(world.last_tick_at) < CADENCE.unwatchedMs) {
        return { status: 'idle', worldId } as const;
      }

      const state = await loadState(tx, world, content, now, tickSeq);
      state.world.watched = watched;
      // After the Player rows are locked (loadState), so no submit_intent is half-way through.
      const intents = await loadIntents(tx, worldId);

      const started = performance.now();
      const { facts, stateDiff } = simulate(state, intents, tickSeed(world.seed, tickSeq));
      const next = applyDiff(state, stateDiff);
      const hash = stateHash(next);
      const cpuMs = Math.round(performance.now() - started);
      const info = { tickSeq, stateHash: hash };

      await insertFacts(tx, worldId, facts.map((fact) => ({ tickSeq, fact })), content);
      await deps.onCommitStep?.('facts', info);

      await commitDiff(tx, worldId, stateDiff, { tickSeq, now });
      await tx`
        update worlds set tick_seq = ${tickSeq}, last_tick_at = ${now}, content_version = ${state.world.contentVersion}
        where id = ${worldId}`;
      await deps.onCommitStep?.('world', info);

      await insertTicks(tx, worldId, [
        {
          seq: tickSeq,
          at: now,
          seed: tickSeed(world.seed, tickSeq),
          watched: state.world.watched,
          contentVersion: state.world.contentVersion,
          intentIds: stateDiff.intents.map((i) => i.id),
          factCount: facts.length,
          cpuMs,
          stateHash: hash,
        },
      ]);
      await deps.onCommitStep?.('tick', info);

      // Last, so it goes out only if everything above commits: one per productive watched tick.
      if (watched && facts.length > 0) await broadcast(tx, worldId, { event: 'tick', payload: { tick_seq: tickSeq } });

      return { status: 'stepped', worldId, tickSeq, factCount: facts.length, stateHash: hash } as const;
    });
  } catch (e) {
    if (isLockNotAvailable(e)) return { status: 'busy', worldId };
    throw e;
  }
}

/** The tick cadence (D39). A world is watched while any of its Players was seen in the last 5 minutes. */
export const CADENCE = { watchedWindowMs: 5 * 60_000, unwatchedMs: 5 * 60_000 } as const;

/**
 * Watched = some Player was seen in the 5 minutes up to the tick's `now` (data-model §3 step 2). A
 * sighting after `now` doesn't count: the tick's clock is the only clock, so injected clocks stay
 * deterministic (in production the two clocks agree, and the client marks itself seen every minute).
 */
async function isWatched(tx: Tx, worldId: string, now: string): Promise<boolean> {
  const [row] = await tx<{ watched: boolean }[]>`
    select exists (
      select 1 from player_private pp join players p on p.id = pp.player_id
      where p.world_id = ${worldId} and p.removed_at is null
        and pp.last_seen_at > ${now}::timestamptz - make_interval(secs => ${CADENCE.watchedWindowMs / 1000})
        and pp.last_seen_at <= ${now}::timestamptz
    ) as watched`;
  return row!.watched;
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
  const fearRows = await tx<{ captain_id: string; fear: string; added: boolean; since: string }[]>`
    select captain_id, fear, added, to_json(since)#>>'{}' as since
    from captain_fears where world_id = ${world.id} order by captain_id, since, fear`;
  const affinityRows = await tx<{ holder_id: string; toward_id: string; value: number }[]>`
    select holder_id, toward_id, value from affinity where world_id = ${world.id}`;
  // The last 3 tags per pair: narration's top tags, and all a pair's Blame can use (the newest 3
  // within 7 days, decision 8b). Each comes with its Cause and that Cause's Blame.
  const tagRows = await tx<
    { no: number; holder_id: string; toward_id: string; tag: string; created_at: string; cause_fact: number | null }[]
  >`
    select no::float8 as no, holder_id, toward_id, tag, to_json(created_at)#>>'{}' as created_at,
           cause_fact::float8 as cause_fact
    from (
      select *, row_number() over (partition by holder_id, toward_id order by no desc) as rank
      from grudge_tags where world_id = ${world.id}
    ) t
    where rank <= 3
    order by no`;
  const tagCauses = await loadCauses(
    tx,
    world.id,
    tagRows.flatMap((t) => (t.cause_fact === null ? [] : [t.cause_fact])),
  );

  // FOR UPDATE: blocks submit_intent until this tick commits (data-model decision 2).
  const playerRows = await tx<{ id: string; gold: number; meddles_available: number; first_meddle_done: boolean }[]>`
    select p.id, pp.gold, pp.meddles_available, pp.first_meddle_done
    from player_private pp join players p on p.id = pp.player_id
    where p.world_id = ${world.id} and p.removed_at is null
    order by p.id
    for update of pp`;
  const meddleRows = await tx<MeddleRow[]>`
    select id, player_id, verb, source_id, target_id, claim, subject, free_text, status, held_on
    from meddles where world_id = ${world.id} and status in ('pending', 'held') order by id`;
  // Every pending Fuse (only a few dozen at most), so the loaded state is the state the sim left; the sim
  // fires the due ones itself, in (dueAt, no) order.
  const fuseRows = await tx<
    { no: number; due_at: string; meddle_id: string | null; template_id: string | null; cast: Record<string, string> | null; parent_fact: number | null }[]
  >`
    select no::float8 as no, to_json(due_at)#>>'{}' as due_at, meddle_id, template_id, "cast", parent_fact::float8 as parent_fact
    from fuses where world_id = ${world.id}
    order by due_at, no`;
  const trophyRows = await tx<{ no: number; kind: string; holder_id: string; taken_from_id: string; origin_fact: number }[]>`
    select no::float8 as no, kind, holder_id, taken_from_id, origin_fact::float8 as origin_fact
    from trophies where world_id = ${world.id} order by no`;
  const causes = await loadCauses(tx, world.id, [
    ...trophyRows.map((t) => t.origin_fact),
    ...fuseRows.flatMap((f) => (f.parent_fact === null ? [] : [f.parent_fact])),
  ]);
  const recent = await loadRecent(tx, world.id, now);

  const fears = new Map<string, CaptainState['fears']>();
  for (const f of fearRows) {
    const list = fears.get(f.captain_id) ?? [];
    list.push({ fear: f.fear, added: f.added, since: new Date(f.since).toISOString() });
    fears.set(f.captain_id, list);
  }

  const captains: Record<string, CaptainState> = {};
  for (const c of captainRows) {
    captains[c.id] = {
      id: c.id,
      roster: c.roster,
      power: c.power,
      infamy: c.infamy,
      traits: [c.traits[0]!, c.traits[1]!],
      fears: fears.get(c.id) ?? [],
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
      watched: false, // tickWorld sets it after the cadence check
      day: world.day,
      deathsToday: world.deaths_today,
      warlordId: world.warlord_id,
      nextNo: world.next_no,
      contentVersion: contentVersion(content),
    },
    content,
    captains,
    affinity: Object.fromEntries(affinityRows.map((a) => [`${a.holder_id}>${a.toward_id}`, a.value])),
    grudgeTags: tagRows.map(
      (t): GrudgeTag => ({
        no: t.no,
        holder: t.holder_id,
        toward: t.toward_id,
        tag: t.tag,
        at: new Date(t.created_at).toISOString(),
        // Null: old history seeded at casting, which no Fact caused.
        cause: t.cause_fact === null ? null : tagCauses.get(t.cause_fact)!,
      }),
    ),
    trophies: trophyRows.map((t) => ({
      no: t.no,
      key: t.kind,
      holder: t.holder_id,
      takenFrom: t.taken_from_id,
      origin: causes.get(t.origin_fact)!,
    })),
    humiliations: [],
    stakes: [],
    players: Object.fromEntries(
      playerRows.map((p) => [
        p.id,
        { gold: p.gold, meddles: p.meddles_available, firstMeddleDone: p.first_meddle_done, renderedFor: [] },
      ]),
    ),
    meddles: Object.fromEntries(meddleRows.map((m) => [m.id, toMeddle(m)])),
    fuses: fuseRows.map(
      (f): Fuse => ({
        no: f.no,
        dueAt: new Date(f.due_at).toISOString(),
        ...(f.meddle_id !== null ? { meddleId: f.meddle_id } : {}),
        ...(f.template_id !== null
          ? { reaction: { templateId: f.template_id, cast: f.cast ?? {}, parent: causes.get(f.parent_fact!)! } }
          : {}),
      }),
    ),
    infamy7d: [],
    recent,
  };
}

/**
 * The variety record (D47) rebuilt from the log: when each Template last ran in the last 24 h, and when
 * each pair of Captains last shared a templated Fact in the last hour (key `x|y`, x < y by code unit).
 */
async function loadRecent(tx: Tx, worldId: string, now: string): Promise<WorldState['recent']> {
  const templates = await tx<{ template_id: string; at: string }[]>`
    select template_id, to_json(max(at))#>>'{}' as at
    from facts
    where world_id = ${worldId} and template_id is not null and at > ${now}::timestamptz - interval '24 hours'
    group by template_id`;
  const pairs = await tx<{ pair: string; at: string }[]>`
    select x || '|' || y as pair, to_json(max(f.at))#>>'{}' as at
    from facts f, unnest(f."cast") as x, unnest(f."cast") as y
    where f.world_id = ${worldId} and f.template_id is not null and f.at > ${now}::timestamptz - interval '1 hour'
      and x collate "C" < y collate "C"
    group by 1`;
  return {
    templates: Object.fromEntries(templates.map((t) => [t.template_id, new Date(t.at).toISOString()])),
    pairs: Object.fromEntries(pairs.map((p) => [p.pair, new Date(p.at).toISOString()])),
  };
}

/**
 * Writes a StateDiff to the tables. Extend this alongside the sim: a diff section the commit can't
 * write must fail loudly, never be dropped (applyDiff guards the same list in memory).
 */
async function commitDiff(tx: Tx, worldId: string, diff: StateDiff, at: { tickSeq: number; now: string }): Promise<void> {
  const unsupported = (
    [
      ['captains', diff.captains],
      ['fears', diff.fears],
      ['humiliations', diff.humiliations.upsert],
      ['stakes', diff.stakes],
      ['ledger', diff.ledger],
    ] as [string, unknown[]][]
  ).filter(([, list]) => list.length > 0);
  if (unsupported.length > 0) {
    throw new Error(`commitDiff: unsupported diff sections: ${unsupported.map(([n]) => n).join(', ')}`);
  }

  const w = diff.world;
  if (Object.keys(w).length > 0) {
    await tx`
      update worlds set
        next_no = coalesce(${w.nextNo ?? null}::bigint, next_no),
        deaths_today = coalesce(${w.deathsToday ?? null}::smallint, deaths_today),
        day = coalesce(${w.day ?? null}::date, day),
        warlord_id = case when ${'warlordId' in w} then ${w.warlordId ?? null}::text else warlord_id end
      where id = ${worldId}`;
  }

  // Affinity is absolute; 0 deletes the row.
  const zero = diff.affinity.filter((a) => a.value === 0);
  const set = diff.affinity.filter((a) => a.value !== 0);
  if (zero.length > 0) {
    await tx`
      delete from affinity a using jsonb_array_elements(${jsonb(tx, zero)}) as z
      where a.world_id = ${worldId} and a.holder_id = z->>'holder' and a.toward_id = z->>'toward'`;
  }
  if (set.length > 0) {
    await tx`
      insert into affinity (world_id, holder_id, toward_id, value, updated_at)
      select ${worldId}, a->>'holder', a->>'toward', (a->>'value')::smallint, ${at.now}
      from jsonb_array_elements(${jsonb(tx, set)}) as a
      on conflict (world_id, holder_id, toward_id) do update set value = excluded.value, updated_at = excluded.updated_at`;
  }

  if (diff.grudgeTags.length > 0) {
    await tx`
      insert into grudge_tags (world_id, no, holder_id, toward_id, tag, cause_fact, created_at)
      select ${worldId}, (g->>'no')::bigint, g->>'holder', g->>'toward', g->>'tag', (g#>>'{cause,fact}')::bigint,
             (g->>'at')::timestamptz
      from jsonb_array_elements(${jsonb(tx, diff.grudgeTags)}) as g`;
  }

  // Intents first, then the Meddles they became, then those Meddles' Fuses (FK order).
  if (diff.intents.length > 0) {
    await tx`
      update intents i
      set status = (x->>'status')::intent_status, consumed_tick = ${at.tickSeq}, reject_reason = x->>'reason'
      from jsonb_array_elements(${jsonb(tx, diff.intents)}) as x
      where i.id = (x->>'id')::uuid and i.world_id = ${worldId}`;
  }
  if (diff.newMeddles.length > 0) {
    await tx`
      insert into meddles (id, world_id, player_id, verb, target_id, source_id, victim_id, claim, subject, free_text,
                           dare_key, created_at, status, held_on)
      select (m->>'id')::uuid, ${worldId}, (m->>'playerId')::uuid, (m#>>'{intent,kind}')::meddle_verb,
             m#>>'{intent,target}', m#>>'{intent,source}', m#>>'{intent,victim}', (m#>>'{intent,claim}')::claim,
             m#>'{intent,subject}', m#>>'{intent,freeText}', m#>>'{intent,dareKey}', i.created_at,
             (m->>'status')::meddle_status, m->>'heldOn'
      from jsonb_array_elements(${jsonb(tx, diff.newMeddles)}) as m
      join intents i on i.id = (m->>'id')::uuid`;
  }
  if (diff.meddles.length > 0) {
    await tx`
      update meddles d
      set status = (m->>'status')::meddle_status, held_on = m->>'heldOn', landed_fact = (m->>'landedFact')::bigint
      from jsonb_array_elements(${jsonb(tx, diff.meddles)}) as m
      where d.id = (m->>'id')::uuid and d.world_id = ${worldId}`;
  }
  if (diff.fuses.remove.length > 0) {
    await tx`delete from fuses where world_id = ${worldId} and no = any(${diff.fuses.remove}::bigint[])`;
  }
  await insertFuses(tx, worldId, diff.fuses.add, at.tickSeq);
  await upsertTrophies(tx, worldId, diff.trophies.upsert, at.now);

  // Deltas on the loaded values (the tick holds these rows, so nothing else moved them), capped at 0–6.
  if (diff.playerDeltas.length > 0) {
    await tx`
      update player_private pp
      set meddles_available = least(6, greatest(0, pp.meddles_available + coalesce((d->>'meddles')::int, 0))),
          first_meddle_done = pp.first_meddle_done or coalesce((d->>'firstMeddleDone')::boolean, false)
      from jsonb_array_elements(${jsonb(tx, diff.playerDeltas)}) as d
      where pp.player_id = (d->>'playerId')::uuid`;
  }
}

/** Queued Intents, oldest first. SKIP LOCKED: an Intent still being written is left for the next tick. */
async function loadIntents(tx: Tx, worldId: string): Promise<Intent[]> {
  const rows = await tx<{ id: string; player_id: string; created_at: string; payload: Record<string, unknown> }[]>`
    select id, player_id, to_json(created_at)#>>'{}' as created_at, payload
    from intents where world_id = ${worldId} and status = 'queued'
    order by created_at, id
    for update skip locked`;
  return rows.map((r) => ({ ...r.payload, id: r.id, playerId: r.player_id, at: new Date(r.created_at).toISOString() }) as Intent);
}
