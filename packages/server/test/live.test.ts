// Live watching (#31): the watched check, the 5-minute cadence for unwatched worlds, and the one
// Realtime broadcast per productive watched tick on the private `world:<id>` channel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content } from '@orc/content';
import { dayZero, simulate, tickSeed } from '@orc/sim';
import { tickWorld } from '@orc/server';
import {
  AFTER_DAY_ZERO,
  asUser,
  asUserCommitted,
  db,
  fakeClock,
  freshWorld,
  newUser,
  seedWithFactsOnFirstTick,
} from './support.ts';

type Clock = ReturnType<typeof fakeClock>;

async function worldRow(worldId: string) {
  const [w] = await db()`select tick_seq::int, next_no::int, last_tick_at from worlds where id = ${worldId}`;
  return w!;
}
const factCount = async (worldId: string) =>
  (await db()`select count(*)::int as n from facts where world_id = ${worldId}`)[0]!.n as number;

const tick = (clock: Clock, worldId: string) => tickWorld({ sql: db(), now: clock.now }, worldId);

test('with no Player seen for 5 min, a tick inside 5 min of the last one makes no Facts and does not advance tick_seq', async () => {
  const clock = fakeClock();
  const { worldId } = await freshWorld({ clock });
  clock.advance(5);
  assert.equal((await tick(clock, worldId)).status, 'stepped');
  const before = await worldRow(worldId);
  const facts = await factCount(worldId);

  for (const minutes of [1, 1, 2]) {
    clock.advance(minutes); // 1, 2 and then 4 minutes after the last tick
    assert.deepEqual(await tick(clock, worldId), { status: 'idle', worldId });
  }
  assert.deepEqual(await worldRow(worldId), before);
  assert.equal(await factCount(worldId), facts);
  const [t] = await db()`select count(*)::int as n from ticks where world_id = ${worldId}`;
  assert.equal(t!.n, AFTER_DAY_ZERO + 1, 'no ticks row for an idle call');

  clock.advance(1); // 5 minutes after the last tick: it steps again
  const out = await tick(clock, worldId);
  assert.equal(out.status, 'stepped');
  if (out.status === 'stepped') assert.equal(out.tickSeq, AFTER_DAY_ZERO + 2);
});

/** Marks a Player seen at the clock's time (the RPC uses the database's clock, which a test can't steer). */
const seen = (playerId: string, clock: Clock) =>
  db()`update player_private set last_seen_at = ${clock.iso()} where player_id = ${playerId}`;

test('with a Player seen recently, every tick steps, a minute apart, and is recorded as watched', async () => {
  const clock = fakeClock();
  const { worldId, playerId } = await freshWorld({ clock });
  clock.advance(1);
  await seen(playerId, clock);

  for (let i = 1; i <= 4; i++) {
    const out = await tick(clock, worldId);
    assert.equal(out.status, 'stepped', `tick ${i}`);
    if (out.status === 'stepped') assert.equal(out.tickSeq, AFTER_DAY_ZERO + i);
    clock.advance(1); // the last sighting is 1 to 4 minutes old: still watched
  }
  const rows = await db()`select watched from ticks where world_id = ${worldId} and seq > ${AFTER_DAY_ZERO} order by seq`;
  assert.deepEqual(rows.map((r) => r.watched), [true, true, true, true]);

  // Five minutes after the sighting the world is unwatched again, and back on the 5-minute cadence.
  clock.advance(1);
  assert.equal((await tick(clock, worldId)).status, 'idle');
});

test('mark_seen marks the calling Player seen now, and refuses anyone who is not in the world', async () => {
  const clock = fakeClock('2020-01-01T12:00:00.000Z'); // long before the database's own clock
  const { worldId, userId, playerId } = await freshWorld({ clock });
  const lastSeen = async () =>
    (await db()`select last_seen_at from player_private where player_id = ${playerId}`)[0]!.last_seen_at as Date;
  assert.equal((await lastSeen()).toISOString(), clock.iso());

  await asUserCommitted(userId, (tx) => tx`select mark_seen(${worldId})`);
  const [{ now }] = (await db()`select now() as now`) as unknown as [{ now: Date }];
  const marked = await lastSeen();
  assert.ok(Math.abs(marked.getTime() - now.getTime()) < 60_000, `marked seen now (${marked.toISOString()})`);

  const stranger = await newUser();
  await assert.rejects(
    asUser(stranger, (tx) => tx`select mark_seen(${worldId})`),
    (e: Error) => e.message === 'not_a_player',
  );
  // Nobody can write the column directly: player_private is read-only to its owner.
  await assert.rejects(asUser(userId, (tx) => tx`update player_private set last_seen_at = now() where player_id = ${playerId}`));
});

/**
 * A world seed whose first tick after day zero, watched and 1 minute after creation, makes Facts (or,
 * with `facts: false`, makes none). Found by asking the sim, like `seedWithFactsOnFirstTick`.
 */
function seedForWatchedTick(facts: boolean, createdAt = '2026-10-30T12:00:00.000Z'): number {
  for (let seed = 1; seed < 1000; seed++) {
    const { state } = dayZero(content, seed, createdAt, '');
    const tickSeq = state.world.tickSeq + 1;
    const now = new Date(Date.parse(createdAt) + 60_000).toISOString();
    const out = simulate({ ...state, world: { ...state.world, tickSeq, now, watched: true } }, [], tickSeed(seed, tickSeq));
    if (out.facts.length > 0 === facts) return seed;
  }
  throw new Error('no seed found');
}

/** The broadcasts sent on a world's channel (Realtime delivers what's written to realtime.messages). */
const broadcasts = (worldId: string) =>
  db()<{ event: string; private: boolean; payload: Record<string, unknown> }[]>`
    select event, private, payload from realtime.messages where topic = ${`world:${worldId}`} order by inserted_at`;

test('a watched tick that makes Facts sends exactly one private broadcast {tick_seq} on world:<id>', async () => {
  const clock = fakeClock();
  const { worldId, playerId } = await freshWorld({ clock, seed: seedForWatchedTick(true) });
  clock.advance(1);
  await seen(playerId, clock);

  const out = await tick(clock, worldId);
  assert.equal(out.status, 'stepped');
  assert.ok(out.status === 'stepped' && out.factCount > 0);
  const sent = await broadcasts(worldId);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.event, 'tick');
  assert.equal(sent[0]!.private, true);
  assert.equal(sent[0]!.payload.tick_seq, AFTER_DAY_ZERO + 1);
});

test('a watched tick that makes no Facts sends no broadcast', async () => {
  const clock = fakeClock();
  const { worldId, playerId } = await freshWorld({ clock, seed: seedForWatchedTick(false) });
  clock.advance(1);
  await seen(playerId, clock);

  const out = await tick(clock, worldId);
  assert.ok(out.status === 'stepped' && out.factCount === 0);
  assert.equal((await broadcasts(worldId)).length, 0);
});

test('an unwatched tick sends no broadcast, even when it makes Facts', async () => {
  const clock = fakeClock();
  const { worldId } = await freshWorld({ clock, seed: seedWithFactsOnFirstTick() });
  clock.advance(5);

  const out = await tick(clock, worldId);
  assert.ok(out.status === 'stepped' && out.factCount > 0);
  assert.equal((await broadcasts(worldId)).length, 0);
});

/**
 * Whether Realtime would let this user join the private channel `topic`, checked the way Realtime does
 * on join: a probe message on the topic is written, then read back as the user with `realtime.topic`
 * set; joining is allowed if RLS shows it. Rolled back.
 */
async function canSubscribe(userId: string, topic: string): Promise<boolean> {
  let visible = false;
  await db()
    .begin(async (tx) => {
      const [probe] = await tx`
        insert into realtime.messages (topic, extension, private) values (${topic}, 'broadcast', true) returning id`;
      await tx`select set_config('realtime.topic', ${topic}, true)`;
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;
      await tx`set local role authenticated`;
      visible = (await tx`select id from realtime.messages where id = ${probe!.id}`).length === 1;
      throw new ProbeDone();
    })
    .catch((e: unknown) => {
      if (!(e instanceof ProbeDone)) throw e;
    });
  return visible;
}
class ProbeDone extends Error {}

test("only the world's Players can subscribe to its channel, and nobody but the tick can send on it", async () => {
  const clock = fakeClock();
  const world = await freshWorld({ clock });
  const other = await freshWorld({ clock });
  const stranger = await newUser();
  const topic = `world:${world.worldId}`;

  assert.equal(await canSubscribe(world.userId, topic), true, 'a member can');
  assert.equal(await canSubscribe(stranger, topic), false, 'a signed-in stranger cannot');
  assert.equal(await canSubscribe(other.userId, topic), false, "another world's Player cannot");
  assert.equal(await canSubscribe(world.userId, 'world:not-a-uuid'), false, 'a malformed topic is refused, not an error');
  assert.equal(await canSubscribe(world.userId, `other:${world.worldId}`), false, 'other topics stay closed');

  await assert.rejects(
    asUser(world.userId, async (tx) => {
      await tx`select set_config('realtime.topic', ${topic}, true)`;
      await tx`insert into realtime.messages (topic, extension, private, event, payload)
               values (${topic}, 'broadcast', true, 'tick', '{"tick_seq": 1}')`;
    }),
    /row-level security/,
  );
});
