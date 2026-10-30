import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tickWorld, type CommitStep } from '@orc/server';
import { AFTER_DAY_ZERO, db, fakeClock, freshWorld, seedWithFactsOnFirstTick } from './support.ts';

// A fresh world has already ticked through day zero, so its first live tick is AFTER_DAY_ZERO + 1.
const FIRST = AFTER_DAY_ZERO + 1;

async function worldRow(worldId: string) {
  const [w] = await db()`select tick_seq::int, next_no::int, last_tick_at from worlds where id = ${worldId}`;
  return w!;
}
const count = async (table: 'facts' | 'ticks', worldId: string) =>
  (await db()`select count(*)::int as n from ${db()(table)} where world_id = ${worldId}`)[0]!.n as number;

test('a tick steps the world and records it: Facts, tick_seq, next_no and the ticks row', async () => {
  const clock = fakeClock();
  const { worldId } = await freshWorld({ clock, seed: seedWithFactsOnFirstTick() });
  const before = await worldRow(worldId);
  assert.equal(before.tick_seq, AFTER_DAY_ZERO);
  clock.advance(5);

  const out = await tickWorld({ sql: db(), now: clock.now }, worldId);
  assert.equal(out.status, 'stepped');
  if (out.status !== 'stepped') return;
  assert.equal(out.tickSeq, FIRST);
  assert.ok(out.factCount > 0);

  const w = await worldRow(worldId);
  assert.equal(w.tick_seq, FIRST);
  assert.equal(w.next_no, before.next_no + out.factCount);
  assert.equal(new Date(w.last_tick_at).toISOString(), clock.iso());

  const facts = await db()`
    select no::int, tick_seq::int, at, kind, line, tier from facts where world_id = ${worldId} and tick_seq = ${FIRST}`;
  assert.equal(facts.length, out.factCount);
  for (const f of facts) {
    assert.ok(f.no >= before.next_no);
    assert.equal(new Date(f.at).toISOString(), clock.iso());
    assert.equal(f.kind, 'incident');
    assert.ok(f.line.length > 0);
  }

  const [t] = await db()`
    select seq::int, fact_count, state_hash, content_version, watched from ticks where world_id = ${worldId} and seq = ${FIRST}`;
  assert.equal(t!.fact_count, out.factCount);
  assert.equal(t!.state_hash, out.stateHash);
  assert.equal(t!.watched, false);
});

test('two concurrent tick calls on one world: the second exits without stepping', async () => {
  const clock = fakeClock();
  const { worldId } = await freshWorld({ clock });
  clock.advance(5);

  // The first tick pauses while holding the world lock until the second has run.
  let releaseFirst!: () => void;
  const gate = new Promise<void>((r) => (releaseFirst = r));
  let signalLocked!: () => void;
  const firstHoldsLock = new Promise<void>((r) => (signalLocked = r));
  const hold = async (step: CommitStep) => {
    if (step !== 'locked') return;
    signalLocked();
    await gate;
  };

  const first = tickWorld({ sql: db(), now: clock.now, onCommitStep: hold }, worldId);
  await firstHoldsLock;
  const second = await tickWorld({ sql: db(), now: clock.now }, worldId);
  releaseFirst();

  assert.deepEqual(second, { status: 'busy', worldId });
  assert.equal((await first).status, 'stepped');
  assert.equal((await worldRow(worldId)).tick_seq, FIRST);
  assert.equal(await count('ticks', worldId), FIRST);
});

for (const failAt of ['facts', 'world', 'tick'] as const) {
  test(`a failure injected after the "${failAt}" commit step leaves no partial rows, and the retry gives the same state hash`, async () => {
    const clock = fakeClock();
    const { worldId } = await freshWorld({ clock, seed: seedWithFactsOnFirstTick() });
    clock.advance(5);
    const before = await worldRow(worldId);
    const factsBefore = await count('facts', worldId);

    let hashSeen: string | undefined;
    await assert.rejects(
      tickWorld(
        {
          sql: db(),
          now: clock.now,
          onCommitStep: (step, info) => {
            hashSeen = info.stateHash;
            if (step === failAt) throw new Error('injected failure');
          },
        },
        worldId,
      ),
      /injected failure/,
    );

    assert.deepEqual(await worldRow(worldId), before, 'world row untouched');
    assert.equal(await count('facts', worldId), factsBefore, 'no Facts committed');
    assert.equal(await count('ticks', worldId), AFTER_DAY_ZERO, 'no ticks row committed');

    const retry = await tickWorld({ sql: db(), now: clock.now }, worldId);
    assert.equal(retry.status, 'stepped');
    if (retry.status !== 'stepped') return;
    assert.equal(retry.tickSeq, FIRST, 'the retry reuses the same tick_seq');
    assert.ok(retry.factCount > 0);
    assert.equal(retry.stateHash, hashSeen);
    const [t] = await db()`select state_hash from ticks where world_id = ${worldId} and seq = ${FIRST}`;
    assert.equal(t!.state_hash, hashSeen);
  });
}

test('ticks keep stepping the same world, each with its own seq', async () => {
  const clock = fakeClock();
  const { worldId } = await freshWorld({ clock });
  for (let i = 0; i < 5; i++) {
    clock.advance(5);
    const out = await tickWorld({ sql: db(), now: clock.now }, worldId);
    assert.equal(out.status, 'stepped');
    if (out.status === 'stepped') assert.equal(out.tickSeq, FIRST + i);
  }
  assert.equal(await count('ticks', worldId), AFTER_DAY_ZERO + 5);
  // Grudge tags and Facts share the sim's per-world counter: every number is used exactly once.
  const nos = await db()`
    select no::int from facts where world_id = ${worldId}
    union all select no::int from grudge_tags where world_id = ${worldId}
    order by no`;
  assert.deepEqual(
    nos.map((f) => f.no),
    nos.map((_, i) => i + 1),
    'sim-allocated numbers are dense from 1',
  );
});
