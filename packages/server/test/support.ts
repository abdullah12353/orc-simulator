// Seam B helpers: talk to Postgres directly, with an injected clock and a fresh world per test. Run these
// suites only through `npm run test:db`: it makes this worktree's own database and passes its URL.
import { after } from 'node:test';
import { randomUUID } from 'node:crypto';
import { content, type Content } from '@orc/content';
import { DAY_ZERO, dayZero, simulate, tickSeed } from '@orc/sim';
import { connect, createWorld, type ProviderKeys, type Sql, type WorkersAi } from '@orc/server';

const url = process.env.ORC_DB_URL;
if (!url) throw new Error('ORC_DB_URL is not set: run Seam B through `npm run test:db`');
export const DB_URL: string = url;

let shared: Sql | undefined;
// Registered at import (file level), not inside a test, or it would close the pool after that test.
after(() => shared?.end({ timeout: 5 }));

/** One pool per test file, closed when the file's tests finish. */
export function db(): Sql {
  shared ??= connect(DB_URL, { max: 5 });
  return shared;
}

/**
 * A Workers AI binding over a fake `fetch`, so one fake can play both providers: `run` posts its inputs
 * (with its abort signal) and answers what the REST API would have put under `result`.
 */
export function aiOverFetch(fetch: typeof globalThis.fetch): WorkersAi {
  return {
    async run(model, inputs, options) {
      const res = await fetch(`https://workers-ai.test/run/${model}`, { method: 'POST', body: JSON.stringify(inputs), signal: options?.signal });
      const data = (await res.json()) as { result?: unknown };
      if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data)}`);
      return data.result;
    },
  };
}

/** Both providers, played by one fake `fetch`. */
export const fakeKeys = (fetch: typeof globalThis.fetch): ProviderKeys => ({ workersAi: aiOverFetch(fetch), groq: { apiKey: 'test-groq-key' } });

/** A controllable clock: starts at `start`, moves only when told to. */
export function fakeClock(start = '2026-10-30T12:00:00.000Z') {
  let t = Date.parse(start);
  return {
    now: () => new Date(t),
    advance: (minutes: number) => {
      t += minutes * 60_000;
    },
    iso: () => new Date(t).toISOString(),
  };
}

/** Inserts a Neon Auth user with a verified email, as if they had signed in by magic link. */
export async function newUser(sql: Sql = db()): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into neon_auth."user" (id, name, email, "emailVerified")
    values (${id}, 'Test User', ${`${id}@test.local`}, true)`;
  return id;
}

/** Runs fn inside a transaction as the given user, the way PostgREST would (role + JWT claims). */
export async function asUser<T>(userId: string, fn: (tx: Sql) => Promise<T>, sql: Sql = db()): Promise<T> {
  let result!: T;
  try {
    await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;
      await tx`set local role authenticated`;
      result = await fn(tx as unknown as Sql);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return result;
}
class Rollback extends Error {}

/** Like `asUser`, but commits: for multi-step flows (invites, joins) whose effects later steps read. */
export async function asUserCommitted<T>(userId: string, fn: (tx: Sql) => Promise<T>, sql: Sql = db()): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;
    await tx`set local role authenticated`;
    return fn(tx as unknown as Sql);
  })) as T;
}

/**
 * Runs `fn` inside one transaction that is then rolled back, handing it a pool whose `begin` makes a
 * savepoint: code that opens its own transactions (the tick) runs unchanged, and leaves no trace. Lets a
 * test run one world down two paths from the same start.
 */
export async function rolledBack(fn: (sql: Sql) => Promise<void>, sql: Sql = db()): Promise<void> {
  try {
    await sql.begin(async (tx) => {
      const nested = new Proxy(tx, {
        get: (target, key) => (key === 'begin' ? (cb: never) => target.savepoint(cb) : Reflect.get(target, key)),
      }) as unknown as Sql;
      await fn(nested);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

/** Every table a tick writes, keyed to one world (player_private through its Player). */
export const TICK_TABLES = [
  'worlds', 'facts', 'fact_causes', 'fact_blame', 'ticks', 'captains', 'affinity', 'grudge_tags', 'trophies',
  'captain_fears', 'humiliations', 'infamy_gains', 'intents', 'meddles', 'fuses', 'stakes', 'gold_ledger',
  'player_private', 'clash_dialogue', 'narration_jobs', 'push_jobs',
] as const;

/** Every row of every table the tick writes, for one world, as JSON (sorted, so two snapshots compare). */
export async function snapshot(worldId: string): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const table of TICK_TABLES) {
    const where =
      table === 'worlds'
        ? db()`id = ${worldId}`
        : table === 'player_private'
          ? db()`player_id in (select id from players where world_id = ${worldId})`
          : db()`world_id = ${worldId}`;
    const rows = await db()`select to_jsonb(t)::text as row from ${db()(table)} t where ${where}`;
    out[table] = rows.map((r) => r.row as string).sort();
  }
  return out;
}

/** The tick_seq a fresh world is at: day zero already ran this many ticks. */
export const AFTER_DAY_ZERO = DAY_ZERO.steps;

/**
 * A world seed whose first tick after day zero is guaranteed to produce Facts (found by asking the
 * sim). `createdAt` is when the world is created; the tick is 5 minutes later.
 */
export function seedWithFactsOnFirstTick(c: Content = content, createdAt = '2026-10-30T12:00:00.000Z'): number {
  for (let seed = 1; seed < 1000; seed++) {
    const { state } = dayZero(c, seed, createdAt, '');
    const tickSeq = state.world.tickSeq + 1;
    const now = new Date(Date.parse(createdAt) + 5 * 60_000).toISOString();
    const { facts } = simulate({ ...state, world: { ...state.world, tickSeq, now } }, [], tickSeed(seed, tickSeq));
    if (facts.length > 0) return seed;
  }
  throw new Error('no seed found');
}

/** A fresh world with its creator, at the clock's current time. */
export async function freshWorld(opts: { clock: ReturnType<typeof fakeClock>; seed?: number; sql?: Sql }) {
  const sql = opts.sql ?? db();
  const userId = await newUser(sql);
  const { worldId, playerId } = await createWorld(
    { sql, now: opts.clock.now, randomSeed: () => opts.seed ?? 12345 },
    { userId, name: 'Test Fortress', displayName: 'Mo' },
  );
  return { worldId, playerId, userId };
}

export interface StoryFact {
  /** Minutes after `from`. */
  minute: number;
  weight?: number;
  kind?: string;
  tier?: 'generated' | 'templated' | 'silent';
  /** The head this consequence belongs to (an index into the same list); omit for a head. */
  consequenceOf?: number;
  /** Or: the number of a head already in the log that this consequence belongs to. */
  storyNo?: number;
  /** For a `legendary` consequence: the head (an index into the same list) that was the deed. */
  deed?: number;
  line?: string;
  /** Extra payload fields, for kinds that need them (an Accusation's accuser, accused, clipKey…). */
  payload?: Record<string, unknown>;
}

/**
 * Appends hand-made Facts to a world's log, numbered from its `next_no` (which it then moves on, so
 * the sim never reuses a number). Lets Herald tests control weights, times, kinds and tiers exactly.
 * Returns the Fact numbers, in list order.
 */
export async function insertStoryFacts(worldId: string, from: string, list: StoryFact[], sql: Sql = db()): Promise<number[]> {
  const [w] = await sql<{ next_no: number; tick_seq: number }[]>`
    select next_no::int, tick_seq::int from worlds where id = ${worldId}`;
  const nos = list.map((_, i) => w!.next_no + i);
  const rows = list.map((f, i) => {
    const no = nos[i]!;
    const head = f.consequenceOf === undefined && f.storyNo === undefined;
    const fact = {
      no,
      at: new Date(Date.parse(from) + f.minute * 60_000).toISOString(),
      storyNo: head ? no : (f.storyNo ?? nos[f.consequenceOf!]!),
      line: f.line ?? `Story fact ${no}.`,
      tier: f.tier ?? 'templated',
      cast: [],
      causes: [],
      blame: [],
      infamy: [],
      kind: f.kind ?? (head ? 'incident' : 'power'),
      ...(head ? { comedyWeight: f.weight ?? 4 } : {}),
      ...(f.deed !== undefined ? { deed: nos[f.deed]! } : {}),
      ...f.payload,
    };
    return { tickSeq: w!.tick_seq, fact };
  });
  await sql`
    insert into facts (world_id, no, tick_seq, at, kind, story_no, line, tier, "cast", comedy_weight, payload)
    select ${worldId}, (f->>'no')::bigint, (r->>'tickSeq')::bigint, (f->>'at')::timestamptz, f->>'kind',
           (f->>'storyNo')::bigint, f->>'line', (f->>'tier')::tier, '{}', (f->>'comedyWeight')::smallint, f
    from jsonb_array_elements(${sql.json(rows)}) as r, lateral (select r->'fact' as f) as x`;
  await sql`update worlds set next_no = ${w!.next_no + list.length} where id = ${worldId}`;
  return nos;
}
