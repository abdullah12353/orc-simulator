import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleTick } from '@orc/server';
import { db, fakeClock, freshWorld } from './support.ts';

const SECRET = 'test-secret';
const call = (clock: ReturnType<typeof fakeClock>, init: RequestInit) =>
  handleTick(new Request('http://x/tick', init), { sql: db(), now: clock.now, secret: SECRET });

test('the tick endpoint refuses calls without the shared secret', async () => {
  const clock = fakeClock();
  const { worldId } = await freshWorld({ clock });
  const body = JSON.stringify({ worldId });
  assert.equal((await call(clock, { method: 'POST', body })).status, 401);
  assert.equal((await call(clock, { method: 'POST', body, headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await call(clock, { method: 'GET', headers: { authorization: `Bearer ${SECRET}` } })).status, 405);
  const [w] = await db()`select tick_seq::int from worlds where id = ${worldId}`;
  assert.equal(w!.tick_seq, 0);
});

test('a POST with the secret and no body ticks every world (what the clock Worker sends)', async () => {
  const clock = fakeClock();
  const a = await freshWorld({ clock });
  const b = await freshWorld({ clock });
  clock.advance(5);
  const res = await call(clock, { method: 'POST', headers: { authorization: `Bearer ${SECRET}` } });
  assert.equal(res.status, 200);
  const { outcomes } = (await res.json()) as { outcomes: { worldId: string; status: string }[] };
  for (const id of [a.worldId, b.worldId]) {
    assert.equal(outcomes.find((o) => o.worldId === id)?.status, 'stepped');
  }
});
