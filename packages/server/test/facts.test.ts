import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tickWorld } from '@orc/server';
import { asUser, db, fakeClock, freshWorld, seedWithFactsOnFirstTick } from './support.ts';

async function worldWithFacts() {
  const clock = fakeClock();
  const world = await freshWorld({ clock, seed: seedWithFactsOnFirstTick() });
  clock.advance(5);
  const out = await tickWorld({ sql: db(), now: clock.now }, world.worldId);
  assert.ok(out.status === 'stepped' && out.factCount > 0);
  return world;
}

test('facts reject UPDATE and DELETE from a signed-in member', async () => {
  const { worldId, userId } = await worldWithFacts();
  await asUser(userId, async (tx) => {
    const visible = await tx`select no from facts where world_id = ${worldId}`;
    assert.ok(visible.length > 0, 'the member can read the Facts');
  });
  await assert.rejects(
    asUser(userId, (tx) => tx`update facts set line = 'rewritten' where world_id = ${worldId}`),
    /permission denied/,
  );
  await assert.rejects(
    asUser(userId, (tx) => tx`delete from facts where world_id = ${worldId}`),
    /permission denied/,
  );
});

test("facts reject UPDATE, DELETE and TRUNCATE even from the tick's own connection", async () => {
  const { worldId } = await worldWithFacts();
  await assert.rejects(db()`update facts set line = 'rewritten' where world_id = ${worldId}`, /append-only/);
  await assert.rejects(db()`delete from facts where world_id = ${worldId}`, /append-only/);
  await assert.rejects(db()`truncate facts cascade`, /append-only/);
  const [n] = await db()`select count(*)::int as n from facts where world_id = ${worldId} and line = 'rewritten'`;
  assert.equal(n!.n, 0);
});
