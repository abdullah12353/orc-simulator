// Live watching (#31): the 5-minute cadence for unwatched worlds, every call stepping a watched one, and
// the one live hint per productive watched tick. Whether a world is watched comes from outside the
// database (the world's Durable Object knows from its live connections, #55), so tests pass it in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content } from '@orc/content';
import { dayZero, simulate, tickSeed } from '@orc/sim';
import { tickWorld } from '@orc/server';
import { AFTER_DAY_ZERO, db, fakeClock, freshWorld, seedWithFactsOnFirstTick } from './support.ts';

type Clock = ReturnType<typeof fakeClock>;

async function worldRow(worldId: string) {
  const [w] = await db()`select tick_seq::int, next_no::int, last_tick_at from worlds where id = ${worldId}`;
  return w!;
}
const factCount = async (worldId: string) =>
  (await db()`select count(*)::int as n from facts where world_id = ${worldId}`)[0]!.n as number;

const tick = (clock: Clock, worldId: string, watched = false) =>
  tickWorld({ sql: db(), now: clock.now, watched: (w) => watched && w === worldId }, worldId);

test('unwatched, a tick inside 5 min of the last one makes no Facts and does not advance tick_seq', async () => {
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

test('watched, every tick steps, a minute apart, and is recorded as watched', async () => {
  const clock = fakeClock();
  const { worldId } = await freshWorld({ clock });

  for (let i = 1; i <= 4; i++) {
    clock.advance(1);
    const out = await tick(clock, worldId, true);
    assert.equal(out.status, 'stepped', `tick ${i}`);
    if (out.status === 'stepped') assert.equal(out.tickSeq, AFTER_DAY_ZERO + i);
  }
  const rows = await db()`select watched from ticks where world_id = ${worldId} and seq > ${AFTER_DAY_ZERO} order by seq`;
  assert.deepEqual(rows.map((r) => r.watched), [true, true, true, true]);

  // Unwatched again, it's back on the 5-minute cadence.
  clock.advance(1);
  assert.equal((await tick(clock, worldId)).status, 'idle');
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

test('a watched tick that makes Facts returns exactly one hint, {tick_seq}, once it has committed', async () => {
  const clock = fakeClock();
  const { worldId } = await freshWorld({ clock, seed: seedForWatchedTick(true) });
  clock.advance(1);

  const out = await tick(clock, worldId, true);
  assert.ok(out.status === 'stepped' && out.factCount > 0);
  assert.deepEqual(out.hint, { event: 'tick', payload: { tick_seq: AFTER_DAY_ZERO + 1 } });
  assert.equal((await worldRow(worldId)).tick_seq, AFTER_DAY_ZERO + 1, 'the tick it points at is committed');
});

test('a watched tick that makes no Facts returns no hint', async () => {
  const clock = fakeClock();
  const { worldId } = await freshWorld({ clock, seed: seedForWatchedTick(false) });
  clock.advance(1);

  const out = await tick(clock, worldId, true);
  assert.ok(out.status === 'stepped' && out.factCount === 0);
  assert.equal(out.hint, null);
});

test('an unwatched tick returns no hint, even when it makes Facts', async () => {
  const clock = fakeClock();
  const { worldId } = await freshWorld({ clock, seed: seedWithFactsOnFirstTick() });
  clock.advance(5);

  const out = await tick(clock, worldId);
  assert.ok(out.status === 'stepped' && out.factCount > 0);
  assert.equal(out.hint, null);
});
