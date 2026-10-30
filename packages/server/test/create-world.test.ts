import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content } from '@orc/content';
import { handleCreateWorld, tickWorld } from '@orc/server';
import { AFTER_DAY_ZERO, asUser, db, fakeClock, freshWorld, newUser, seedWithFactsOnFirstTick } from './support.ts';

test('create_world makes the caller the first Player and casts the content bundle', async () => {
  const clock = fakeClock();
  const { worldId, playerId, userId } = await freshWorld({ clock });

  await asUser(userId, async (tx) => {
    const [w] = await tx`select name, tick_seq::int, created_by, warlord_id from worlds where id = ${worldId}`;
    assert.equal(w!.name, 'Test Fortress');
    assert.equal(w!.tick_seq, AFTER_DAY_ZERO, 'day zero already ran');
    assert.equal(w!.created_by, playerId);
    assert.notEqual(w!.warlord_id, 'krug', 'Krúg is never the starting Warlord');

    const players = await tx`select id, display_name from players where world_id = ${worldId}`;
    assert.deepEqual(players.map((p) => [p.id, p.display_name]), [[playerId, 'Mo']]);

    const captains = await tx`select id from captains where world_id = ${worldId} order by id`;
    assert.deepEqual(
      captains.map((c) => c.id),
      content.cast.map((c) => c.id).sort(),
    );
  });
});

test("a signed-in creator reads the world's Fact lines, newest first; an outsider reads nothing", async () => {
  const clock = fakeClock();
  const { worldId, userId } = await freshWorld({ clock, seed: seedWithFactsOnFirstTick() });
  for (let i = 0; i < 30; i++) {
    clock.advance(5);
    await tickWorld({ sql: db(), now: clock.now }, worldId);
  }

  const lines = await asUser(userId, (tx) => tx`select no::int, at, line from facts where world_id = ${worldId} order by at desc, no desc`);
  assert.ok(lines.length > 0);
  for (let i = 1; i < lines.length; i++) assert.ok(lines[i - 1]!.no > lines[i]!.no, 'newest first');

  const outsider = await newUser();
  await asUser(outsider, async (tx) => {
    assert.equal((await tx`select 1 from facts where world_id = ${worldId}`).length, 0);
    assert.equal((await tx`select 1 from worlds where id = ${worldId}`).length, 0);
    assert.equal((await tx`select 1 from captains where world_id = ${worldId}`).length, 0);
    assert.equal((await tx`select 1 from players where world_id = ${worldId}`).length, 0);
  });
  await assert.rejects(asUser(userId, (tx) => tx`select * from ticks`), /permission denied/);
});

test('the create-world endpoint needs a signed-in user and a name', async () => {
  const clock = fakeClock();
  const userId = await newUser();
  const deps = { sql: db(), now: clock.now, randomSeed: () => 7 };
  const post = (body: unknown, user: string | null) =>
    handleCreateWorld(new Request('http://x/create-world', { method: 'POST', body: JSON.stringify(body) }), {
      ...deps,
      getUserId: async () => user,
    });

  assert.equal((await post({ name: 'Nope', displayName: 'Mo' }, null)).status, 401);
  assert.equal((await post({ name: '  ', displayName: 'Mo' }, userId)).status, 400);
  const ok = await post({ name: 'Gutterholm', displayName: 'Mo' }, userId);
  assert.equal(ok.status, 201);
  const { worldId } = (await ok.json()) as { worldId: string };
  const [w] = await db()`select name from worlds where id = ${worldId}`;
  assert.equal(w!.name, 'Gutterholm');
});
