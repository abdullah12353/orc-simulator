// #43 First open and hints: a late joiner's first edition, the guided first Rumour (first_meddle_done
// and its short Fuse), the once-only first open, and one-line hints recorded in hints_seen.
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openEdition, tickWorld } from '@orc/server';
import { asUser, asUserCommitted, db, fakeClock, freshWorld, insertStoryFacts, newUser } from './support.ts';

type Clock = ReturnType<typeof fakeClock>;
type World = Awaited<ReturnType<typeof freshWorld>>;

const HOUR_MS = 3600_000;
const iso = (d: Date | string | number) => new Date(d).toISOString();
const failsWith = (reason: string) => (e: unknown) => {
  assert.equal((e as Error).message, reason);
  return true;
};

async function joinAs(world: World, name: string) {
  const [inv] = await asUserCommitted(world.userId, (tx) => tx`select token from create_invite(${world.worldId})`);
  const userId = await newUser();
  const [row] = await asUserCommitted(userId, (tx) => tx`select join_world(${inv!.token}, ${name}) as id`);
  return { worldId: world.worldId, userId, playerId: row!.id as string };
}

async function rumourPayload(worldId: string, extra: Record<string, unknown> = {}) {
  const rows = await db()<{ id: string; traits: string[] }[]>`
    select id, traits from captains where world_id = ${worldId} and roster = 'active' order by id`;
  const [source, target] = [rows[0]!, rows[1]!];
  return { source: source.id, target: target.id, claim: 'insult', subject: { from: 'trait', key: target.traits[0]! }, ...extra };
}

async function submit(userId: string, worldId: string, kind: string, payload: unknown, id = randomUUID()) {
  await asUserCommitted(userId, (tx) => tx`select * from submit_intent(${id}, ${worldId}, ${kind}, ${tx.json(payload as never)})`);
  return id;
}

const firstMeddleDone = async (playerId: string) =>
  (await db()`select first_meddle_done from player_private where player_id = ${playerId}`)[0]!.first_meddle_done as boolean;

async function fuseMinutes(meddleId: string, clock: Clock): Promise<number> {
  const [f] = await db()`
    select extract(epoch from due_at - ${clock.iso()}::timestamptz)::int / 60 as minutes from fuses where meddle_id = ${meddleId}`;
  return f!.minutes as number;
}

test("a late joiner's first edition covers the last 24 h, not day zero", async () => {
  const clock = fakeClock();
  const createdAt = clock.iso();
  const world = await freshWorld({ clock });
  const [old, recent] = await insertStoryFacts(world.worldId, createdAt, [
    { minute: 60 * 10, weight: 40, line: 'Krúg sat on the war drum.' }, // day one, long gone by the time they join
    { minute: 60 * 60, weight: 5, line: 'Gorbag lost a boot in the moat.' }, // 12 h before they open
  ]);

  clock.advance(72 * 60); // three days later, a friend joins
  const late = await joinAs(world, 'Dazza');
  const out = await openEdition({ sql: db(), now: clock.now }, { userId: late.userId, worldId: world.worldId });

  assert.equal(out.created, true);
  assert.equal(out.edition.no, 1);
  assert.equal(iso(out.edition.coversFrom), iso(Date.parse(clock.iso()) - 24 * HOUR_MS), 'the last 24 h');
  assert.equal(iso(out.edition.coversTo), clock.iso());
  const printed = out.edition.stories.map((s) => s.storyNo);
  assert.ok(printed.includes(recent!), 'the story from 12 h ago is in');
  assert.ok(!printed.includes(old!), 'the story from day one is not');
  assert.ok(out.edition.stories.every((s) => s.storyNo > old!), 'nothing from day zero either');
});

test('the first window never reaches back more than 24 h: a friend who joins 90 min in gets most of day zero', async () => {
  const clock = fakeClock();
  const createdAt = clock.iso();
  const world = await freshWorld({ clock });
  clock.advance(90);
  const friend = await joinAs(world, 'Dazza');
  const out = await openEdition({ sql: db(), now: clock.now }, { userId: friend.userId, worldId: world.worldId });
  assert.equal(iso(out.edition.coversFrom), iso(Date.parse(createdAt) - 22.5 * HOUR_MS), 'the last 24 h');
  assert.ok(out.edition.stories.length > 0, 'day zero still fills it');
});

test('first_meddle_done is set once the guided Rumour is submitted, and that Rumour gets the 2–5 min Fuse', async () => {
  const clock = fakeClock();
  const world = await freshWorld({ clock });
  assert.equal(await firstMeddleDone(world.playerId), false);

  const guided = await submit(world.userId, world.worldId, 'rumour', await rumourPayload(world.worldId, { firstMeddle: true }));
  assert.equal(await firstMeddleDone(world.playerId), true, 'set at submit, before any tick');

  clock.advance(5);
  assert.equal((await tickWorld({ sql: db(), now: clock.now }, world.worldId)).status, 'stepped');
  const m = await fuseMinutes(guided, clock);
  assert.ok(m >= 2 && m <= 5, `the guided Rumour's Fuse is ${m} min`);
  assert.equal(await firstMeddleDone(world.playerId), true);

  // A client that flags its next Rumour as the first again doesn't get another short Fuse.
  const later = await submit(world.userId, world.worldId, 'rumour', await rumourPayload(world.worldId, { firstMeddle: true }));
  const [i] = await db()`select payload from intents where id = ${later}`;
  assert.equal(i!.payload.firstMeddle, false, 'submit_intent clears the flag once the first Meddle is done');
  clock.advance(5);
  await tickWorld({ sql: db(), now: clock.now }, world.worldId);
  const n = await fuseMinutes(later, clock);
  assert.ok(n >= 10 && n <= 90, `a later Rumour waits ${n} min`);
});

test('any first Meddle (a Dare, or an unguided Rumour) uses up first_meddle_done; Backing does not', async () => {
  const world = await freshWorld({ clock: fakeClock() });
  const [c] = await db()`select id from captains where world_id = ${world.worldId} and roster = 'active' order by id limit 1`;
  await submit(world.userId, world.worldId, 'back', { captainId: c!.id, amount: 5 });
  assert.equal(await firstMeddleDone(world.playerId), false, 'Backing is not a Meddle');
  await submit(world.userId, world.worldId, 'rumour', await rumourPayload(world.worldId));
  assert.equal(await firstMeddleDone(world.playerId), true);
});

test('begin_first_open is true exactly once per Player, and stamps first_open_at', async () => {
  const world = await freshWorld({ clock: fakeClock() });
  const firstOpen = async (userId = world.userId) =>
    (await asUserCommitted(userId, (tx) => tx`select begin_first_open(${world.worldId}) as first`))[0]!.first as boolean;

  const [before] = await asUser(world.userId, (tx) => tx`select first_open_at from player_private where player_id = ${world.playerId}`);
  assert.equal(before!.first_open_at, null, 'the Player can read that they have never opened');
  assert.equal(await firstOpen(), true);
  assert.equal(await firstOpen(), false, 'the next open is not a first open');
  const [after] = await db()`select first_open_at from player_private where player_id = ${world.playerId}`;
  assert.ok(after!.first_open_at instanceof Date);

  const friend = await joinAs(world, 'Dazza');
  assert.equal(await firstOpen(friend.userId), true, 'every Player gets their own first open');
  await assert.rejects(firstOpen(await newUser()), failsWith('not_a_player'));
});

test('see_hint is true the first time a Player meets a hint and never again', async () => {
  const world = await freshWorld({ clock: fakeClock() });
  const see = async (hint: string, userId = world.userId) =>
    (await asUserCommitted(userId, (tx) => tx`select see_hint(${world.worldId}, ${hint}) as fresh`))[0]!.fresh as boolean;

  assert.equal(await see('dare'), true);
  assert.equal(await see('dare'), false);
  assert.equal(await see('backing'), true);
  assert.equal(await see('stable'), true);
  assert.equal(await see('backing'), false);
  assert.equal(await see('stable'), false);
  const [p] = await db()`select hints_seen from player_private where player_id = ${world.playerId}`;
  assert.deepEqual(p!.hints_seen, ['dare', 'backing', 'stable']);

  await assert.rejects(see('tutorial'), failsWith('bad_hint'));
  await assert.rejects(see('dare', await newUser()), failsWith('not_a_player'));
  const friend = await joinAs(world, 'Dazza');
  assert.equal(await see('dare', friend.userId), true, "one Player's hints are their own");
});
