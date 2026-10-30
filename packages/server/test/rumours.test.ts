// #28 Rumours end to end: submit_intent, the tick consuming Intents and firing Fuses, Meddle secrecy
// under RLS, and the landed Rumour in the Herald.
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openEdition, tickWorld } from '@orc/server';
import { asUser, asUserCommitted, db, fakeClock, freshWorld, newUser } from './support.ts';

type Clock = ReturnType<typeof fakeClock>;
type World = Awaited<ReturnType<typeof freshWorld>>;

const failsWith = (reason: string) => (e: unknown) => {
  assert.equal((e as Error).message, reason);
  return true;
};

/** Two active Captains and a Trait of the second, to plant a valid Rumour with. */
async function pair(worldId: string, skip = 0) {
  const rows = await db()<{ id: string; traits: string[] }[]>`
    select id, traits from captains where world_id = ${worldId} and roster = 'active' order by id`;
  const source = rows[skip % rows.length]!;
  const target = rows[(skip + 1) % rows.length]!;
  return { source: source.id, target: target.id, trait: target.traits[0]!, notHisTrait: source.traits.find((t) => !target.traits.includes(t))! };
}

function rumourPayload(p: { source: string; target: string; trait: string }, extra: Record<string, unknown> = {}) {
  return { source: p.source, target: p.target, claim: 'insult', subject: { from: 'trait', key: p.trait }, ...extra };
}

async function submit(userId: string, worldId: string, payload: unknown, id = randomUUID()) {
  const [row] = await asUserCommitted(userId, (tx) =>
    tx`select intent_id, meddles_left from submit_intent(${id}, ${worldId}, 'rumour', ${tx.json(payload as never)})`,
  );
  return { id, meddlesLeft: row!.meddles_left as number };
}

const meddlesAvailable = async (playerId: string) =>
  (await db()`select meddles_available from player_private where player_id = ${playerId}`)[0]!.meddles_available as number;

async function tick(world: World, clock: Clock, minutes = 5) {
  clock.advance(minutes);
  const out = await tickWorld({ sql: db(), now: clock.now }, world.worldId);
  assert.equal(out.status, 'stepped');
  return out;
}

async function secondPlayer(world: World) {
  const [inv] = await asUserCommitted(world.userId, (tx) => tx`select token from create_invite(${world.worldId})`);
  const userId = await newUser();
  const [row] = await asUserCommitted(userId, (tx) => tx`select join_world(${inv!.token}, 'Dazza') as id`);
  return { userId, playerId: row!.id as string };
}

test('submitting a Rumour debits a Meddle at once, and resubmitting the same id does not debit again', async () => {
  const world = await freshWorld({ clock: fakeClock() });
  const p = await pair(world.worldId);
  assert.equal(await meddlesAvailable(world.playerId), 3);

  const first = await submit(world.userId, world.worldId, rumourPayload(p));
  assert.equal(first.meddlesLeft, 2);
  assert.equal(await meddlesAvailable(world.playerId), 2);

  const again = await submit(world.userId, world.worldId, rumourPayload(p), first.id);
  assert.equal(again.meddlesLeft, 2, 'idempotent on the client-generated id');
  assert.equal(await meddlesAvailable(world.playerId), 2);
  const [n] = await db()`select count(*)::int as n from intents where id = ${first.id}`;
  assert.equal(n!.n, 1);

  const mine = await asUser(world.userId, (tx) => tx`select id, status from intents where world_id = ${world.worldId}`);
  assert.deepEqual(mine.map((i) => [i.id, i.status]), [[first.id, 'queued']], 'a Player reads their own Intents');
});

test('a Player cannot submit with 0 Meddles left', async () => {
  const world = await freshWorld({ clock: fakeClock() });
  const p = await pair(world.worldId);
  for (let i = 0; i < 3; i++) await submit(world.userId, world.worldId, rumourPayload(p));
  assert.equal(await meddlesAvailable(world.playerId), 0);
  await assert.rejects(submit(world.userId, world.worldId, rumourPayload(p)), failsWith('no_meddles_left'));
  assert.equal(await meddlesAvailable(world.playerId), 0);
  const [n] = await db()`select count(*)::int as n from intents where player_id = ${world.playerId}`;
  assert.equal(n!.n, 3);
});

test('submit_intent refuses outsiders and malformed Rumours', async () => {
  const world = await freshWorld({ clock: fakeClock() });
  const p = await pair(world.worldId);
  await assert.rejects(submit(await newUser(), world.worldId, rumourPayload(p)), failsWith('not_a_player'));
  await assert.rejects(submit(world.userId, world.worldId, rumourPayload(p, { claim: 'slander' })), failsWith('bad_rumour'));
  await assert.rejects(submit(world.userId, world.worldId, { ...rumourPayload(p), subject: 'pies' }), failsWith('bad_rumour'));
  await assert.rejects(
    submit(world.userId, world.worldId, rumourPayload(p, { freeText: 'x'.repeat(201) })),
    failsWith('bad_rumour'),
  );
  assert.equal(await meddlesAvailable(world.playerId), 3, 'nothing debited');
});

test('the tick consumes a Rumour into a pending Meddle on a Fuse; a rejected one is refunded', async () => {
  const clock = fakeClock();
  const world = await freshWorld({ clock });
  const p = await pair(world.worldId);
  const good = await submit(world.userId, world.worldId, rumourPayload(p, { freeText: 'his helmet is a bucket' }));
  const bad = await submit(world.userId, world.worldId, rumourPayload({ ...p, trait: p.notHisTrait }));
  assert.equal(await meddlesAvailable(world.playerId), 1);

  const out = await tick(world, clock);

  const intents = await db()`select id, status, consumed_tick::int, reject_reason from intents where world_id = ${world.worldId}`;
  const byId = new Map(intents.map((i) => [i.id, i]));
  assert.equal(byId.get(good.id)!.status, 'consumed');
  assert.equal(byId.get(good.id)!.consumed_tick, out.status === 'stepped' ? out.tickSeq : -1);
  assert.equal(byId.get(bad.id)!.status, 'rejected');
  assert.equal(byId.get(bad.id)!.reject_reason, 'bad_subject');
  assert.equal(await meddlesAvailable(world.playerId), 2, 'the rejected Meddle came back');

  const [m] = await db()`
    select verb, status, source_id, target_id, claim, subject, free_text, landed_fact from meddles where id = ${good.id}`;
  assert.deepEqual(
    { ...m },
    { verb: 'rumour', status: 'pending', source_id: p.source, target_id: p.target, claim: 'insult', subject: { from: 'trait', key: p.trait }, free_text: 'his helmet is a bucket', landed_fact: null },
  );
  const [f] = await db()`
    select extract(epoch from due_at - ${clock.iso()}::timestamptz)::int / 60 as minutes, kind from fuses where meddle_id = ${good.id}`;
  assert.equal(f!.kind, 'meddle');
  assert.ok(f!.minutes >= 10 && f!.minutes <= 90, `${f!.minutes} min`);
  assert.equal((await db()`select count(*)::int as n from meddles where id = ${bad.id}`)[0]!.n, 0);

  const [t] = await db()`select intent_ids from ticks where world_id = ${world.worldId} order by seq desc limit 1`;
  assert.deepEqual([...t!.intent_ids].sort(), [good.id, bad.id].sort());
});

test("another Player can't see my pending Meddle, but can once it lands; nobody reads Fuses", async () => {
  const clock = fakeClock();
  const world = await freshWorld({ clock });
  const friend = await secondPlayer(world);
  const p = await pair(world.worldId);
  const { id } = await submit(world.userId, world.worldId, rumourPayload(p));
  await tick(world, clock);

  const sees = async (userId: string) =>
    (await asUser(userId, (tx) => tx`select id from meddles where world_id = ${world.worldId}`)).map((r) => r.id);
  assert.deepEqual(await sees(world.userId), [id], 'mine, while pending');
  assert.deepEqual(await sees(friend.userId), [], "not my friend's");
  assert.deepEqual(
    (await asUser(friend.userId, (tx) => tx`select id from intents where world_id = ${world.worldId}`)).length,
    0,
    'nor my Intents',
  );
  await assert.rejects(asUser(world.userId, (tx) => tx`select * from fuses`), /permission denied/);

  const pendingFacts = await db()`select no from facts where world_id = ${world.worldId} and payload::text like ${'%' + id + '%'}`;
  assert.equal(pendingFacts.length, 0, 'no Fact carries a pending Meddle');

  await tick(world, clock, 95);
  const [m] = await db()`select status, landed_fact::int from meddles where id = ${id}`;
  assert.equal(m!.status, 'landed');
  assert.deepEqual(await sees(friend.userId), [id], 'landed: Blame reveals it');
  const [head] = await asUser(friend.userId, (tx) => tx`select kind, payload from facts where world_id = ${world.worldId} and no = ${m!.landed_fact}`);
  assert.equal(head!.kind, 'rumour');
  assert.equal(head!.payload.meddleId, id);
});

test('a landed Rumour moves directed affinity and adds a permanent Grudge tag', async () => {
  const clock = fakeClock();
  const world = await freshWorld({ clock });
  const p = await pair(world.worldId, 2);
  const { id } = await submit(world.userId, world.worldId, rumourPayload(p));
  await tick(world, clock);
  await tick(world, clock, 95);

  const [m] = await db()`select landed_fact::int from meddles where id = ${id}`;
  const [head] = await db()`select payload from facts where world_id = ${world.worldId} and no = ${m!.landed_fact}`;
  const reached = head!.payload.reached as string;
  const [a] = await db()`
    select value from affinity where world_id = ${world.worldId} and holder_id = ${reached} and toward_id = ${p.source}`;
  assert.ok(a && a.value < 0, `affinity ${reached}>${p.source} is ${a?.value}`);
  const tags = await db()`
    select tag, cause_fact::int from grudge_tags where world_id = ${world.worldId} and holder_id = ${reached} and toward_id = ${p.source}`;
  assert.ok(tags.some((t) => t.cause_fact === m!.landed_fact), 'a tag caused by the Rumour');
});

test('after an outage, overdue Fuses fire in due order on one tick, with no extra ambient incidents', async () => {
  const clock = fakeClock();
  const world = await freshWorld({ clock });
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) ids.push((await submit(world.userId, world.worldId, rumourPayload(await pair(world.worldId, i)))).id);
  await tick(world, clock);
  const fuses = await db()`select meddle_id from fuses where world_id = ${world.worldId} order by due_at, no`;
  assert.equal(fuses.length, 3);

  const out = await tick(world, clock, 6 * 60); // six hours of nothing
  const facts = await db()`
    select kind, payload->>'meddleId' as meddle_id from facts
    where world_id = ${world.worldId} and tick_seq = ${out.status === 'stepped' ? out.tickSeq : -1} order by no`;
  assert.deepEqual(
    facts.filter((f) => f.kind === 'rumour').map((f) => f.meddle_id),
    fuses.map((f) => f.meddle_id),
    'every overdue Fuse fired, in due order',
  );
  assert.ok(facts.filter((f) => f.kind === 'incident').length <= 1, 'one ambient roll, not 72');
  assert.equal((await db()`select count(*)::int as n from fuses where world_id = ${world.worldId}`)[0]!.n, 0);
});

test('the day roll at midnight London grants 3 Meddles, capped at 6', async () => {
  const clock = fakeClock('2026-10-30T23:50:00.000Z');
  const world = await freshWorld({ clock });
  const friend = await secondPlayer(world);
  await db()`update player_private set meddles_available = 5 where player_id = ${friend.playerId}`;
  await db()`update player_private set meddles_available = 1 where player_id = ${world.playerId}`;
  await tick(world, clock, 5);
  assert.equal(await meddlesAvailable(world.playerId), 1, 'not midnight yet');
  await tick(world, clock, 10);
  assert.equal(await meddlesAvailable(world.playerId), 4);
  assert.equal(await meddlesAvailable(friend.playerId), 6);
  const [w] = await db()`select day::text from worlds where id = ${world.worldId}`;
  assert.equal(w!.day, '2026-10-31');
});

test('the landed Rumour appears as a story in my next edition', async () => {
  const clock = fakeClock();
  const world = await freshWorld({ clock });
  await openEdition({ sql: db(), now: clock.now }, world); // edition #1: day zero
  const p = await pair(world.worldId, 4);
  const { id } = await submit(world.userId, world.worldId, rumourPayload(p));
  await tick(world, clock);
  await tick(world, clock, 95);
  const [m] = await db()`select landed_fact::int from meddles where id = ${id}`;
  assert.ok(m!.landed_fact);

  const out = await openEdition({ sql: db(), now: clock.now }, world);
  assert.equal(out.created, true);
  assert.equal(out.edition.no, 2);
  const story = out.edition.stories.find((s) => s.storyNo === m!.landed_fact);
  assert.ok(story, 'the Rumour is in the edition');
  const [head] = await db()`select line from facts where world_id = ${world.worldId} and no = ${m!.landed_fact}`;
  assert.equal(story.headline, head!.line);
});
