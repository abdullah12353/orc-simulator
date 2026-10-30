import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content } from '@orc/content';
import { applyDiff, dayZero, simulate, stateHash, tickSeed } from '@orc/sim';
import { tickWorld } from '@orc/server';
import { asUser, db, fakeClock, freshWorld, newUser } from './support.ts';

const DAY_MS = 24 * 60 * 60_000;
const iso = (d: Date | string) => new Date(d).toISOString();

test('create_world casts the world: 12 active with Krúg, the rest in reserve, the Warlord, Fears and Grudges', async () => {
  const clock = fakeClock();
  const createdAt = clock.iso();
  const { worldId, userId } = await freshWorld({ clock, seed: 2024 });
  const { state } = dayZero(content, 2024, createdAt, worldId);

  await asUser(userId, async (tx) => {
    const captains = await tx`select id, roster, power, epithet from captains where world_id = ${worldId} order by id`;
    assert.equal(captains.length, 30);
    const active = captains.filter((c) => c.roster === 'active');
    assert.equal(active.length, 12);
    assert.ok(active.some((c) => c.id === 'krug'));
    assert.equal(captains.filter((c) => c.roster === 'reserve').length, 18);
    for (const c of captains) {
      assert.equal(c.epithet, content.cast.find((card) => card.id === c.id)!.epithet ?? null, c.id);
    }

    const [w] = await tx`select warlord_id from worlds where id = ${worldId}`;
    const top = Math.max(...active.map((c) => c.power));
    assert.equal(captains.find((c) => c.id === w!.warlord_id)?.power, top);
    assert.notEqual(w!.warlord_id, 'krug');

    const fears = await tx`select captain_id, fear, added from captain_fears where world_id = ${worldId}`;
    assert.equal(fears.length, 30);
    assert.ok(fears.every((f) => !f.added));
    assert.deepEqual(
      fears.find((f) => f.captain_id === 'krug'),
      { captain_id: 'krug', fear: 'Water', added: false },
    );

    const tags = await tx`
      select no::int, holder_id, toward_id, tag, cause_fact from grudge_tags where world_id = ${worldId} order by no`;
    assert.deepEqual(
      tags.map((t) => [t.no, t.holder_id, t.toward_id, t.tag, t.cause_fact]),
      state.grudgeTags.map((t) => [t.no, t.holder, t.toward, t.tag, null]),
    );
    assert.ok(tags.length >= 5 && tags.length <= 7);
    const affinity = await tx<{ holder_id: string; toward_id: string; value: number }[]>`
      select holder_id, toward_id, value from affinity where world_id = ${worldId}`;
    assert.equal(affinity.length, tags.length);
    for (const a of affinity) {
      assert.equal(a.value, state.affinity[`${a.holder_id}>${a.toward_id}`]);
      assert.ok(a.value < -50);
    }
  });
});

test('after create_world, the world has a day of Facts timestamped across the previous 24 h', async () => {
  const clock = fakeClock();
  const createdAt = clock.iso();
  const { worldId, userId } = await freshWorld({ clock, seed: 77 });
  const { state, steps } = dayZero(content, 77, createdAt, worldId);
  const expected = steps.flatMap((s) => s.facts);
  assert.ok(expected.length >= 15, `seed 77 makes ${expected.length} Facts`);

  const facts = await asUser(userId, (tx) =>
    tx`select no::int, tick_seq::int, at, line from facts where world_id = ${worldId} order by no`,
  );
  assert.deepEqual(
    facts.map((f) => [f.no, iso(f.at), f.line]),
    expected.map((f) => [f.no, f.at, f.line]),
  );
  const created = Date.parse(createdAt);
  const times = facts.map((f) => new Date(f.at).getTime());
  assert.ok(times.every((t) => t > created - DAY_MS && t <= created), 'inside the previous 24 h');
  assert.ok(Math.min(...times) < created - 18 * 3600_000, 'starts early in the day');
  assert.ok(Math.max(...times) > created - 6 * 3600_000, 'runs up to creation');
  for (const f of facts) {
    const step = steps.find((s) => s.facts.some((x) => x.no === f.no))!;
    assert.equal(f.tick_seq, step.tickSeq);
  }

  const [w] = await db()`
    select tick_seq::int, next_no::int, last_tick_at, created_at from worlds where id = ${worldId}`;
  assert.equal(w!.tick_seq, 288);
  assert.equal(w!.next_no, state.world.nextNo);
  assert.equal(iso(w!.last_tick_at), createdAt);
  assert.equal(iso(w!.created_at), createdAt);

  const ticks = await db()`select seq::int, at, state_hash, watched from ticks where world_id = ${worldId} order by seq`;
  assert.equal(ticks.length, 288);
  assert.ok(ticks.every((t, i) => t.seq === i + 1 && !t.watched && iso(t.at) === steps[i]!.at));
  assert.equal(ticks.at(-1)!.state_hash, stateHash(state));
});

test('the first tick after create_world carries on exactly where the in-memory day zero left off', async () => {
  const clock = fakeClock();
  const createdAt = clock.iso();
  const seed = 31337;
  const { worldId } = await freshWorld({ clock, seed });
  clock.advance(5);

  const { state } = dayZero(content, seed, createdAt, worldId);
  const input = { ...state, world: { ...state.world, tickSeq: 289, prevTickAt: state.world.now, now: clock.iso() } };
  const { facts, stateDiff } = simulate(input, [], tickSeed(seed, 289));

  const out = await tickWorld({ sql: db(), now: clock.now }, worldId);
  assert.equal(out.status, 'stepped');
  if (out.status !== 'stepped') return;
  assert.equal(out.tickSeq, 289);
  assert.equal(out.factCount, facts.length);
  assert.equal(out.stateHash, stateHash(applyDiff(input, stateDiff)), 'the tick loaded the same state (Fears, Grudges, Epithets)');
});

test('Fears, affinity and Grudge tags are readable by world members only', async () => {
  const clock = fakeClock();
  const { worldId, userId } = await freshWorld({ clock });
  const count = async (user: string, table: string) =>
    asUser(user, async (tx) => (await tx`select count(*)::int as n from ${tx(table)} where world_id = ${worldId}`)[0]!.n);

  for (const table of ['captain_fears', 'affinity', 'grudge_tags']) {
    assert.ok((await count(userId, table)) > 0, `${table}: a member reads it`);
  }
  const outsider = await newUser();
  for (const table of ['captain_fears', 'affinity', 'grudge_tags']) {
    assert.equal(await count(outsider, table), 0, `${table}: an outsider reads nothing`);
  }
  await assert.rejects(asUser(userId, (tx) => tx`delete from affinity where world_id = ${worldId}`), /permission denied/);
});
