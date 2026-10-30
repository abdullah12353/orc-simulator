// Seam B helpers: talk to the local Supabase Postgres directly, with an injected clock and a fresh
// world per test. Run these suites only through `npm run test:db` (it holds the shared-DB lock).
import { after } from 'node:test';
import { randomUUID } from 'node:crypto';
import { content, type Content } from '@orc/content';
import { castWorld, simulate, tickSeed } from '@orc/sim';
import { connect, createWorld, type Sql } from '@orc/server';

export const DB_URL = process.env.ORC_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55422/postgres';

let shared: Sql | undefined;
// Registered at import (file level), not inside a test, or it would close the pool after that test.
after(() => shared?.end({ timeout: 5 }));

/** One pool per test file, closed when the file's tests finish. */
export function db(): Sql {
  shared ??= connect(DB_URL, { max: 5 });
  return shared;
}

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

/** Inserts a confirmed auth user, as if they had signed in by magic link. */
export async function newUser(sql: Sql = db()): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data,
                            raw_user_meta_data, created_at, updated_at)
    values (${id}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            ${`${id}@test.local`}, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())`;
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

/** A world seed whose first tick is guaranteed to produce Facts (found by asking the sim). */
export function seedWithFactsOnFirstTick(c: Content = content, now = '2026-10-30T12:00:00.000Z'): number {
  for (let seed = 1; seed < 10_000; seed++) {
    const state = castWorld(c, seed, now, []);
    const { facts } = simulate({ ...state, world: { ...state.world, tickSeq: 1 } }, [], tickSeed(seed, 1));
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
