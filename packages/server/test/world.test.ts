// #67 The world's Durable Object runs the tick: unwatched worlds catch up in backdated 5-minute steps
// (each consuming only the Intents submitted by its own time), gaps over 72 steps fall back to decision
// 15(a), and re-running work whose commit already landed changes nothing (a killed alarm retries).
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertPlayer, CATCH_UP, catchUp, currentPlayers, openWorld, OpenWorldError, removedSockets, tickWorld, worldTick, type Sql } from '@orc/server';
import { AFTER_DAY_ZERO, asUserCommitted, db, fakeClock, freshWorld, newUser, rolledBack, seedWithFactsOnFirstTick, snapshot } from './support.ts';

const T0 = '2026-10-30T12:00:00.000Z';
const at = (minutes: number) => new Date(Date.parse(T0) + minutes * 60_000);

async function worldRow(worldId: string, sql: Sql = db()) {
  const [w] = await sql<{ tick_seq: number; last_tick_at: string }[]>`
    select tick_seq::int, to_json(last_tick_at)#>>'{}' as last_tick_at from worlds where id = ${worldId}`;
  return { tickSeq: w!.tick_seq, lastTickAt: new Date(w!.last_tick_at).toISOString() };
}

/** Two active Captains and a Trait of the second: a valid Rumour. */
async function rumour(worldId: string, skip: number) {
  const rows = await db()<{ id: string; traits: string[] }[]>`
    select id, traits from captains where world_id = ${worldId} and roster = 'active' order by id`;
  const source = rows[skip % rows.length]!;
  const target = rows[(skip + 1) % rows.length]!;
  return { source: source.id, target: target.id, claim: 'insult', subject: { from: 'trait', key: target.traits[0]! } };
}

interface Planned {
  id: string;
  kind: 'rumour' | 'back';
  payload: Record<string, unknown>;
  /** Minutes after T0: when the Player submitted it. */
  minute: number;
}

/**
 * Submits an Intent through `submit_intent` as the Player (so gold and Meddles are debited as in
 * production), then dates it to when the plan says it was sent. Runs in its own transaction (or
 * savepoint, under `rolledBack`).
 */
async function submit(sql: Sql, userId: string, worldId: string, i: Planned) {
  await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;
    await tx`set local role authenticated`;
    await tx`select * from submit_intent(${i.id}, ${worldId}, ${i.kind}, ${tx.json(i.payload as never)})`;
    await tx`reset role`;
    await tx`update intents set created_at = ${at(i.minute)} where id = ${i.id}`;
  });
}

test('catching up N missed steps ends in the same state as N live steps fed the same Intents at the same times', async () => {
  const clock = fakeClock(T0);
  const { worldId, userId } = await freshWorld({ clock, seed: seedWithFactsOnFirstTick(undefined, T0) });
  const captain = (await db()<{ id: string }[]>`select id from captains where world_id = ${worldId} and roster = 'active' order by id limit 1`)[0]!.id;
  const N = 12; // an hour of 5-minute steps
  const plan: Planned[] = [
    { id: randomUUID(), kind: 'rumour', payload: await rumour(worldId, 0), minute: 7 },
    { id: randomUUID(), kind: 'back', payload: { captainId: captain, amount: 5 }, minute: 21 },
    // On a step's own time: that step takes it.
    { id: randomUUID(), kind: 'rumour', payload: await rumour(worldId, 2), minute: 25 },
  ];

  // Live: the clock calls every 5 minutes, and each Intent is sent just before the step after it.
  const live: { tickSeq: number; stateHash: string; factCount: number }[] = [];
  let liveConsumed: string[] = [];
  await rolledBack(async (sql) => {
    for (let k = 1; k <= N; k++) {
      for (const i of plan.filter((p) => p.minute > (k - 1) * 5 && p.minute <= k * 5)) await submit(sql, userId, worldId, i);
      const out = await tickWorld({ sql, now: () => at(k * 5) }, worldId);
      assert.equal(out.status, 'stepped', `live step ${k}`);
      if (out.status === 'stepped') live.push({ tickSeq: out.tickSeq, stateHash: out.stateHash, factCount: out.factCount });
    }
    liveConsumed = (await sql<{ id: string; consumed_tick: number }[]>`
      select id, consumed_tick::int from intents where world_id = ${worldId} order by id`).map((r) => `${r.id}@${r.consumed_tick}`);
  });
  assert.equal((await worldRow(worldId)).tickSeq, AFTER_DAY_ZERO, 'the live run left no trace');

  // Catch-up: every Intent is already in when the world wakes, two minutes after the last missed step.
  for (const i of plan) await submit(db(), userId, worldId, i);
  clock.advance(N * 5 + 2);
  const report = await catchUp({ sql: db(), now: clock.now }, worldId);

  assert.equal(report.mode, 'replay');
  const caughtUp = report.outcomes.map((o) => {
    assert.equal(o.status, 'stepped');
    return o.status === 'stepped' ? { tickSeq: o.tickSeq, stateHash: o.stateHash, factCount: o.factCount } : null;
  });
  assert.equal(caughtUp.length, N);
  assert.deepEqual(caughtUp.at(-1), live.at(-1), 'the same state hash after the last step');
  assert.ok(live.some((s) => s.factCount > 0), 'the hour had Facts in it');
  // submit_intent debits gold and Meddles when an Intent is sent, so a step before the last Intent's
  // own step sees an earlier balance live than in the catch-up. From that step on, every step matches.
  const lastIntentStep = Math.ceil(Math.max(...plan.map((p) => p.minute)) / 5);
  assert.deepEqual(caughtUp.slice(lastIntentStep - 1), live.slice(lastIntentStep - 1));
  assert.deepEqual(caughtUp.map((s) => s!.factCount), live.map((s) => s.factCount), 'the same Facts at every step');
  const consumed = (await db()<{ id: string; consumed_tick: number }[]>`
    select id, consumed_tick::int from intents where world_id = ${worldId} order by id`).map((r) => `${r.id}@${r.consumed_tick}`);
  assert.deepEqual(consumed, liveConsumed, 'each Intent consumed by the same step');
  const w = await worldRow(worldId);
  assert.deepEqual(w, { tickSeq: AFTER_DAY_ZERO + N, lastTickAt: at(N * 5).toISOString() }, 'the clock is on the last missed step, not now');
});

test('a gap over 72 steps runs one decision-15(a) step and jumps the clock to now', async () => {
  const clock = fakeClock(T0);
  const { worldId } = await freshWorld({ clock });
  clock.advance((CATCH_UP.maxReplaySteps + 1) * 5 + 2);

  const report = await catchUp({ sql: db(), now: clock.now }, worldId);

  assert.equal(report.mode, 'jump');
  assert.equal(report.outcomes.length, 1);
  assert.equal(report.outcomes[0]!.status, 'stepped');
  assert.deepEqual(await worldRow(worldId), { tickSeq: AFTER_DAY_ZERO + 1, lastTickAt: clock.iso() });
  assert.equal(report.tickSeq, AFTER_DAY_ZERO + 1);
});

test('a gap of exactly 72 steps is still replayed step by step', async () => {
  const clock = fakeClock(T0);
  const { worldId } = await freshWorld({ clock });
  clock.advance(CATCH_UP.maxReplaySteps * 5 + 4);

  const report = await catchUp({ sql: db(), now: clock.now }, worldId);

  assert.equal(report.mode, 'replay');
  assert.equal(report.outcomes.filter((o) => o.status === 'stepped').length, CATCH_UP.maxReplaySteps);
  assert.deepEqual(await worldRow(worldId), {
    tickSeq: AFTER_DAY_ZERO + CATCH_UP.maxReplaySteps,
    lastTickAt: at(CATCH_UP.maxReplaySteps * 5).toISOString(),
  });
});

test("a backdated step doesn't consume an Intent submitted after its own time", async () => {
  const clock = fakeClock(T0);
  const { worldId, userId } = await freshWorld({ clock });
  const early: Planned = { id: randomUUID(), kind: 'rumour', payload: await rumour(worldId, 0), minute: 7 };
  const late: Planned = { id: randomUUID(), kind: 'rumour', payload: await rumour(worldId, 1), minute: 12 };
  for (const i of [early, late]) await submit(db(), userId, worldId, i);

  // Woken at 12:10:30: steps at 12:05 and 12:10. Both Intents are in the table already.
  clock.advance(10.5);
  const report = await catchUp({ sql: db(), now: clock.now }, worldId);
  assert.equal(report.outcomes.length, 2);

  const status = async (id: string) =>
    (await db()<{ status: string; consumed_tick: number | null }[]>`select status::text, consumed_tick::int from intents where id = ${id}`)[0];
  assert.deepEqual(await status(early.id), { status: 'consumed', consumed_tick: AFTER_DAY_ZERO + 2 }, 'not by the 12:05 step');
  assert.deepEqual(await status(late.id), { status: 'queued', consumed_tick: null }, 'sent at 12:12, after the 12:10 step');

  // The next step, at 12:15, takes it.
  clock.advance(5);
  await catchUp({ sql: db(), now: clock.now }, worldId);
  assert.deepEqual(await status(late.id), { status: 'consumed', consumed_tick: AFTER_DAY_ZERO + 3 });
});

test('re-running a tick whose commit already landed changes nothing', async () => {
  const clock = fakeClock(T0);
  const { worldId } = await freshWorld({ clock, seed: seedWithFactsOnFirstTick(undefined, T0) });

  // A catch-up commits, then its alarm is retried (the DO was killed before it knew).
  clock.advance(17);
  const first = await catchUp({ sql: db(), now: clock.now }, worldId);
  assert.equal(first.outcomes.length, 3);
  const after = await snapshot(worldId);
  const again = await catchUp({ sql: db(), now: clock.now }, worldId);
  assert.deepEqual(again, { mode: 'none', outcomes: [], tickSeq: AFTER_DAY_ZERO + 3 });
  assert.deepEqual(await snapshot(worldId), after);

  // The same backdated step, asked for again: idle.
  assert.deepEqual(await tickWorld({ sql: db(), now: clock.now }, worldId, { at: at(15) }), { status: 'idle', worldId });
  assert.deepEqual(await tickWorld({ sql: db(), now: clock.now }, worldId, { at: at(10) }), { status: 'idle', worldId });
  assert.deepEqual(await snapshot(worldId), after);

  // A watched minute tick, retried later in the same minute: it lands on the top of the minute, once.
  clock.advance(0.25); // 12:17:15
  const watched = await worldTick({ sql: db(), now: clock.now }, worldId, { watched: true });
  assert.equal(watched.live?.status, 'stepped');
  const afterWatched = await snapshot(worldId);
  assert.deepEqual(await worldRow(worldId), { tickSeq: AFTER_DAY_ZERO + 4, lastTickAt: at(17).toISOString() });
  clock.advance(0.5); // 12:17:45
  const retried = await worldTick({ sql: db(), now: clock.now }, worldId, { watched: true });
  assert.deepEqual(retried.live, { status: 'idle', worldId });
  assert.deepEqual(retried.hints, []);
  assert.deepEqual(await snapshot(worldId), afterWatched);
});

test('a watched world catches up its missed unwatched steps first, then takes the minute step', async () => {
  const clock = fakeClock(T0);
  const { worldId } = await freshWorld({ clock });
  clock.advance(11.5); // 12:11:30

  const report = await worldTick({ sql: db(), now: clock.now }, worldId, { watched: true });

  assert.equal(report.catchUp.outcomes.length, 2, '12:05 and 12:10, unwatched');
  assert.equal(report.live?.status, 'stepped');
  const rows = await db()<{ seq: number; at: Date; watched: boolean }[]>`
    select seq::int, at, watched from ticks where world_id = ${worldId} and seq > ${AFTER_DAY_ZERO} order by seq`;
  assert.deepEqual(
    rows.map((r) => [r.seq, new Date(r.at).toISOString(), r.watched]),
    [
      [AFTER_DAY_ZERO + 1, at(5).toISOString(), false],
      [AFTER_DAY_ZERO + 2, at(10).toISOString(), false],
      [AFTER_DAY_ZERO + 3, at(11).toISOString(), true],
    ],
  );
});

test('opening a world catches it up for its Players only', async () => {
  const clock = fakeClock(T0);
  const { worldId, userId } = await freshWorld({ clock });
  clock.advance(31);

  const stranger = await newUser();
  await assert.rejects(openWorld({ sql: db(), now: clock.now }, { userId: stranger, worldId }), (e) => e instanceof OpenWorldError && e.message === 'not_a_player');
  assert.equal((await worldRow(worldId)).tickSeq, AFTER_DAY_ZERO, "a stranger's open doesn't wake the world");

  assert.deepEqual(await openWorld({ sql: db(), now: clock.now }, { userId, worldId }), { tickSeq: AFTER_DAY_ZERO + 6 });
});

test('the member list the DO re-reads each tick leaves out removed Players, and their sockets are the ones closed', async () => {
  const clock = fakeClock(T0);
  const { worldId, userId: creator } = await freshWorld({ clock });
  const [invite] = await asUserCommitted(creator, (tx) => tx`select token from create_invite(${worldId})`);
  const friend = await newUser();
  await asUserCommitted(friend, (tx) => tx`select join_world(${invite!.token}, 'Dazza')`);
  const stranger = await newUser();
  const sockets = [{ user: creator }, { user: friend }, { user: stranger }, { user: null }];
  const userOf = (s: { user: string | null }) => s.user;

  assert.deepEqual(await currentPlayers({ sql: db() }, worldId), new Set([creator, friend]));
  assert.deepEqual(removedSockets(sockets, userOf, await currentPlayers({ sql: db() }, worldId)), [sockets[2], sockets[3]]);

  await db()`update players set removed_at = ${clock.iso()} where world_id = ${worldId} and user_id = ${friend}`;
  assert.deepEqual(await currentPlayers({ sql: db() }, worldId), new Set([creator]));
  assert.deepEqual(removedSockets(sockets, userOf, await currentPlayers({ sql: db() }, worldId)), sockets.slice(1));
  await assert.rejects(assertPlayer({ sql: db() }, { userId: friend, worldId }), (e) => e instanceof OpenWorldError && e.message === 'not_a_player');
});
