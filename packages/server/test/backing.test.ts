// #36 Backing and gold through the database: submit_intent debits a Stake at once, the tick turns back and
// withdraw intents into `stakes` and `gold_ledger` rows, the day roll pays the Stipend, and privacy holds:
// who backs whom is public through `backers`, amounts, gold and the ledger are owner-only.
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content } from '@orc/content';
import { tickWorld } from '@orc/server';
import { applyDiff, dayZero, simulate, STARTING, stateHash, tickSeed, type Intent, type StateDiff, type WorldState } from '@orc/sim';
import { asUser, asUserCommitted, db, fakeClock, freshWorld, newUser } from './support.ts';

type Clock = ReturnType<typeof fakeClock>;
type World = Awaited<ReturnType<typeof freshWorld>>;

const failsWith = (reason: string) => (e: unknown) => {
  assert.equal((e as Error).message, reason);
  return true;
};

async function submit(userId: string, worldId: string, kind: 'back' | 'withdraw', payload: unknown, id = randomUUID()) {
  await asUserCommitted(userId, (tx) => tx`select intent_id from submit_intent(${id}, ${worldId}, ${kind}, ${tx.json(payload as never)})`);
  return id;
}

const goldOf = async (playerId: string) =>
  (await db()`select gold from player_private where player_id = ${playerId}`)[0]!.gold as number;

async function tick(world: World, clock: Clock, minutes = 5) {
  clock.advance(minutes);
  const out = await tickWorld({ sql: db(), now: clock.now }, world.worldId);
  assert.equal(out.status, 'stepped');
  return out;
}

async function captainIds(worldId: string): Promise<string[]> {
  return (await db()<{ id: string }[]>`select id from captains where world_id = ${worldId} order by id`).map((c) => c.id);
}

async function secondPlayer(world: World) {
  const [inv] = await asUserCommitted(world.userId, (tx) => tx`select token from create_invite(${world.worldId})`);
  const userId = await newUser();
  const [row] = await asUserCommitted(userId, (tx) => tx`select join_world(${inv!.token}, 'Haris') as id`);
  return { userId, playerId: row!.id as string };
}

test('backing debits gold at once, with a ledger row; the tick makes the Stake, and a top-up adds to it', async () => {
  const clock = fakeClock();
  const world = await freshWorld({ clock });
  const [krug] = await captainIds(world.worldId);

  const id = await submit(world.userId, world.worldId, 'back', { captainId: krug, amount: 12 });
  assert.equal(await goldOf(world.playerId), 18, 'debited at submit');
  await submit(world.userId, world.worldId, 'back', { captainId: krug, amount: 12 }, id);
  assert.equal(await goldOf(world.playerId), 18, 'idempotent on the intent id');

  await tick(world, clock);
  const stakes = await asUser(world.userId, (tx) => tx`select captain_id, amount from stakes where world_id = ${world.worldId}`);
  assert.deepEqual(stakes.map((s) => [s.captain_id, s.amount]), [[krug, 12]]);

  await submit(world.userId, world.worldId, 'back', { captainId: krug, amount: 3 });
  await tick(world, clock);
  const [after] = await db()`select amount from stakes where player_id = ${world.playerId} and captain_id = ${krug!}`;
  assert.equal(after!.amount, 15);
  assert.equal(await goldOf(world.playerId), 15);

  const ledger = await asUser(world.userId, (tx) =>
    tx`select delta, lost, reason, captain_id from gold_ledger where player_id = ${world.playerId} order by id`);
  assert.deepEqual(
    ledger.map((l) => [l.delta, l.lost, l.reason, l.captain_id]),
    [
      [-12, 0, 'stake', krug],
      [-3, 0, 'top_up', krug],
    ],
  );
});

test('submit_intent refuses a Stake larger than my gold, and nonsense amounts', async () => {
  const world = await freshWorld({ clock: fakeClock() });
  const [krug] = await captainIds(world.worldId);
  await assert.rejects(submit(world.userId, world.worldId, 'back', { captainId: krug, amount: 31 }), failsWith('not_enough_gold'));
  await submit(world.userId, world.worldId, 'back', { captainId: krug, amount: 25 });
  await assert.rejects(submit(world.userId, world.worldId, 'back', { captainId: krug, amount: 6 }), failsWith('not_enough_gold'));
  for (const amount of [0, -4, 1.5, '3']) {
    await assert.rejects(submit(world.userId, world.worldId, 'back', { captainId: krug, amount }), failsWith('bad_stake'), `${amount}`);
  }
  await assert.rejects(submit(world.userId, world.worldId, 'back', { captainId: 'nobody', amount: 1 }), failsWith('bad_stake'));
  assert.equal(await goldOf(world.playerId), 5);
  const [n] = await db()`select count(*)::int as n from intents where player_id = ${world.playerId}`;
  assert.equal(n!.n, 1);
});

test('a withdrawal returns half the Stake, rounded down, at the next tick, and ends it', async () => {
  const clock = fakeClock();
  const world = await freshWorld({ clock });
  const [krug] = await captainIds(world.worldId);
  await submit(world.userId, world.worldId, 'back', { captainId: krug, amount: 7 });
  await tick(world, clock);
  await submit(world.userId, world.worldId, 'withdraw', { captainId: krug });
  assert.equal(await goldOf(world.playerId), 23, 'nothing back until the tick');
  await tick(world, clock);
  assert.equal(await goldOf(world.playerId), 26);
  const stakes = await db()`select * from stakes where player_id = ${world.playerId}`;
  assert.equal(stakes.length, 0);
  const [last] = await db()`select delta, lost, reason from gold_ledger where player_id = ${world.playerId} order by id desc limit 1`;
  assert.deepEqual([last!.delta, last!.lost, last!.reason], [3, 0, 'withdraw']);

  await assert.rejects(submit(world.userId, world.worldId, 'withdraw', { captainId: 7 }), failsWith('bad_stake'));
});

test('the day roll pays the Stipend into the ledger, capped at 30', async () => {
  const clock = fakeClock('2026-10-30T23:40:00.000Z');
  const world = await freshWorld({ clock });
  const [krug] = await captainIds(world.worldId);
  await submit(world.userId, world.worldId, 'back', { captainId: krug, amount: 4 });
  await tick(world, clock, 25); // past midnight London
  assert.equal(await goldOf(world.playerId), 30);
  const rows = await db()`select delta, lost from gold_ledger where player_id = ${world.playerId} and reason = 'stipend'`;
  assert.deepEqual(rows.map((r) => [r.delta, r.lost]), [[4, 6]]);
});

test('Clashes pay Stakes into the ledger, and the database steps exactly like the sim in memory', async () => {
  const clock = fakeClock();
  const createdAt = clock.iso();
  const seed = 9090;
  const world = await freshWorld({ clock, seed });
  const other = await secondPlayer(world);
  let { state } = dayZero(content, seed, createdAt, world.worldId);
  const fresh = { gold: STARTING.gold, meddles: STARTING.meddles, firstMeddleDone: false, renderedFor: [] };
  state = { ...state, players: { [world.playerId]: fresh, [other.playerId]: fresh } };

  // Every active pair hates the next one, so Clashes come thick and fast.
  const active = Object.keys(state.captains).filter((id) => state.captains[id]!.roster === 'active').sort();
  const feuds = active.map((id, i) => ({ holder: id, toward: active[(i + 1) % active.length]!, value: -95 }));
  await db()`
    insert into affinity (world_id, holder_id, toward_id, value, updated_at)
    select ${world.worldId}, a->>'holder', a->>'toward', (a->>'value')::smallint, ${createdAt}
    from jsonb_array_elements(${db().json(feuds)}) as a
    on conflict (world_id, holder_id, toward_id) do update set value = excluded.value`;
  state = { ...state, affinity: { ...state.affinity, ...Object.fromEntries(feuds.map((f) => [`${f.holder}>${f.toward}`, f.value])) } };

  // Both Players back four Captains each, overlapping on two.
  for (const [i, c] of active.slice(0, 4).entries()) await submit(world.userId, world.worldId, 'back', { captainId: c, amount: 3 + i });
  for (const [i, c] of active.slice(2, 6).entries()) await submit(other.userId, world.worldId, 'back', { captainId: c, amount: 5 + i });
  const queued = await db()<{ id: string; player_id: string; created_at: Date; payload: Record<string, unknown> }[]>`
    select id, player_id, created_at, payload from intents where world_id = ${world.worldId} order by created_at, id`;
  let intents = queued.map((r) => ({ ...r.payload, id: r.id, playerId: r.player_id, at: r.created_at.toISOString() }) as Intent);
  for (const p of [world.playerId, other.playerId]) {
    state.players[p] = { ...state.players[p]!, gold: await goldOf(p) };
  }

  const ledger: StateDiff['ledger'] = [];
  for (let i = 0; i < 24; i++) {
    clock.advance(5);
    const tickSeq = state.world.tickSeq + 1;
    const input: WorldState = { ...state, world: { ...state.world, tickSeq, prevTickAt: state.world.now, now: clock.iso() } };
    const { stateDiff } = simulate(input, intents, tickSeed(seed, tickSeq));
    intents = [];
    state = applyDiff(input, stateDiff);
    ledger.push(...stateDiff.ledger);
    const out = await tickWorld({ sql: db(), now: clock.now }, world.worldId);
    assert.equal(out.status, 'stepped');
    if (out.status !== 'stepped') return;
    assert.equal(out.stateHash, stateHash(state), `tick ${tickSeq}: the database state matches memory`);
  }

  assert.ok(ledger.some((l) => l.reason === 'payout_win') && ledger.some((l) => l.reason === 'payout_infamy'), 'wins and Infamy paid');
  const rows = await db()`
    select player_id, delta, lost, reason, fact_no::float8 as fact_no, captain_id from gold_ledger
    where world_id = ${world.worldId} and reason like 'payout%' order by id`;
  assert.deepEqual(
    rows.map((r) => [r.player_id, r.delta, r.lost, r.reason, r.fact_no, r.captain_id]),
    ledger.filter((l) => l.reason.startsWith('payout')).map((l) => [l.playerId, l.delta, l.lost, l.reason, l.fact, l.captainId]),
  );
  for (const p of [world.playerId, other.playerId]) assert.equal(await goldOf(p), state.players[p]!.gold);
  const [edges] = await db()`
    select count(*)::int as n from facts
    where world_id = ${world.worldId} and kind = 'clash' and ((payload->>'edgeA')::float > 0 or (payload->>'edgeB')::float > 0)`;
  assert.ok(edges!.n > 0, 'backed Captains Clashed with their edge');
});

test('another Player sees that I back Krúg, but not how much, nor my gold or ledger', async () => {
  const clock = fakeClock();
  const world = await freshWorld({ clock });
  const other = await secondPlayer(world);
  const [krug] = await captainIds(world.worldId);
  await submit(world.userId, world.worldId, 'back', { captainId: krug, amount: 9 });
  await tick(world, clock);

  const seen = await asUser(other.userId, (tx) => tx`select * from backers where world_id = ${world.worldId}`);
  assert.deepEqual([...seen], [{ world_id: world.worldId, player_id: world.playerId, captain_id: krug }], 'who backs whom, no amount');
  await asUser(other.userId, async (tx) => {
    assert.equal((await tx`select * from stakes where world_id = ${world.worldId}`).length, 0, 'Stakes are owner-only');
    assert.equal((await tx`select * from gold_ledger where world_id = ${world.worldId}`).length, 0, 'the ledger is owner-only');
    assert.equal((await tx`select * from player_private where player_id = ${world.playerId}`).length, 0, 'gold is owner-only');
  });
  const outsider = await newUser();
  assert.equal((await asUser(outsider, (tx) => tx`select * from backers where world_id = ${world.worldId}`)).length, 0);
  await assert.rejects(asUser(world.userId, (tx) => tx`update stakes set amount = 30`), /permission denied/);
  await assert.rejects(asUser(world.userId, (tx) => tx`insert into gold_ledger (world_id, player_id, delta, lost, reason, at) values (${world.worldId}, ${world.playerId}, 30, 0, 'stipend', now())`), /permission denied/);

  // And no Fact in the world carries an amount.
  const facts = await db()`select payload::text as p from facts where world_id = ${world.worldId} and payload::text ~* '"(gold|stakes?|ledger)"'`;
  assert.equal(facts.length, 0);
});
