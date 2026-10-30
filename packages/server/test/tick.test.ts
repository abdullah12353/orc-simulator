import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content } from '@orc/content';
import { dayZero } from '@orc/sim';
import { tickWorld, type CommitStep } from '@orc/server';
import { AFTER_DAY_ZERO, asUserCommitted, db, fakeClock, freshWorld, seedWithFactsOnFirstTick } from './support.ts';

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

/** Every table a tick writes, keyed to one world (player_private through its Player). */
const TICK_TABLES = [
  'worlds', 'facts', 'fact_causes', 'fact_blame', 'ticks', 'captains', 'affinity', 'grudge_tags', 'trophies',
  'captain_fears', 'humiliations', 'infamy_gains', 'intents', 'meddles', 'fuses', 'stakes', 'gold_ledger',
  'player_private', 'clash_dialogue', 'narration_jobs', 'push_jobs',
] as const;
/** The tables the fault test's tick is set up to write to (the criterion names them). */
const MUST_WRITE = ['facts', 'fact_blame', 'ticks', 'clash_dialogue', 'narration_jobs', 'push_jobs', 'intents', 'player_private', 'stakes'] as const;

/** Every row of every table the tick writes, for one world, as JSON (sorted, so two snapshots compare). */
async function snapshot(worldId: string): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const table of TICK_TABLES) {
    const where =
      table === 'worlds'
        ? db()`id = ${worldId}`
        : table === 'player_private'
          ? db()`player_id in (select id from players where world_id = ${worldId})`
          : db()`world_id = ${worldId}`;
    const rows = await db()`select to_jsonb(t)::text as row from ${db()(table)} t where ${where}`;
    out[table] = rows.map((r) => r.row as string).sort();
  }
  return out;
}

/** A world whose seed leaves a Captain dead after day zero, so a Return can be brought forward. */
function seedWithADeadCaptain(createdAt: string): number {
  for (let seed = 1; ; seed++) {
    const { state } = dayZero(content, seed, createdAt, 'probe');
    if (Object.values(state.captains).some((c) => c.roster === 'dead')) return seed;
  }
}

/**
 * A world whose next tick writes to every table in MUST_WRITE: a Rumour's Fuse is due (a landing, with
 * Blame), a Back intent is queued (a Stake), every pair of Captains is feuding (Clashes, so dialogue and
 * narration jobs), and a Captain the creator backs is due to Return to a Player with a device (a push).
 */
async function busyWorld() {
  const clock = fakeClock();
  const world = await freshWorld({ clock, seed: seedWithADeadCaptain(clock.iso()) });
  const submit = (kind: string, payload: unknown) =>
    asUserCommitted(world.userId, (tx) => tx`select * from submit_intent(${randomUUID()}, ${world.worldId}, ${kind}, ${tx.json(payload as never)})`);
  const active = async () =>
    db()<{ id: string; traits: string[] }[]>`select id, traits from captains where world_id = ${world.worldId} and roster = 'active' order by id`;

  // A guided first Rumour: its 2–5 min Fuse is due by the tick after next.
  const [source, target] = await active();
  await submit('rumour', { source: source!.id, target: target!.id, claim: 'insult', subject: { from: 'trait', key: target!.traits[0]! }, firstMeddle: true });
  clock.advance(5);
  assert.equal((await tickWorld({ sql: db(), now: clock.now }, world.worldId)).status, 'stepped');

  const captains = await active();
  await submit('back', { captainId: captains.at(-1)!.id, amount: 5 });
  const [dead] = await db()<{ id: string }[]>`select id from captains where world_id = ${world.worldId} and roster = 'dead' order by id limit 1`;
  await db()`update captains set returns_at = ${clock.iso()} where world_id = ${world.worldId} and id = ${dead!.id}`;
  await db()`
    insert into stakes (world_id, player_id, captain_id, amount, created_at, updated_at)
    values (${world.worldId}, ${world.playerId}, ${dead!.id}, 5, ${clock.iso()}, ${clock.iso()})`;
  await asUserCommitted(world.userId, (tx) => tx`select subscribe_push(${world.worldId}, 'https://push.test/tick', 'p256dh-key', 'auth-secret')`);
  const feuds = captains.flatMap((a) => captains.filter((b) => b.id !== a.id).map((b) => ({ holder: a.id, toward: b.id })));
  await db()`
    insert into affinity (world_id, holder_id, toward_id, value, updated_at)
    select ${world.worldId}, a->>'holder', a->>'toward', -95, ${clock.iso()} from jsonb_array_elements(${db().json(feuds)}) as a
    on conflict (world_id, holder_id, toward_id) do update set value = excluded.value`;
  clock.advance(5);
  return { ...world, clock };
}

for (const failAt of ['facts', 'world', 'tick'] as const) {
  test(`a failure injected after the "${failAt}" commit step leaves no partial rows, and the retry gives the same state hash`, async () => {
    const { worldId, clock } = await busyWorld();
    const before = await snapshot(worldId);

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
    assert.deepEqual(await snapshot(worldId), before, 'no table has a row added, changed or removed');

    const retry = await tickWorld({ sql: db(), now: clock.now }, worldId);
    assert.equal(retry.status, 'stepped');
    if (retry.status !== 'stepped') return;
    assert.equal(retry.tickSeq, FIRST + 1, 'the retry reuses the same tick_seq');
    assert.equal(retry.stateHash, hashSeen);
    const [t] = await db()`select state_hash from ticks where world_id = ${worldId} and seq = ${FIRST + 1}`;
    assert.equal(t!.state_hash, hashSeen);
    // The tick that failed would have written to every one of these, so "no partial rows" above means something.
    const after = await snapshot(worldId);
    for (const table of MUST_WRITE) assert.notDeepEqual(after[table], before[table], `the tick writes ${table}`);
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
  // Facts, Grudge tags, Trophies and Fuses share the sim's per-world counter: every number is used once
  // (fired Fuses are deleted, so there are gaps).
  const nos = await db()`
    select no::int from facts where world_id = ${worldId}
    union all select no::int from grudge_tags where world_id = ${worldId}
    union all select no::int from trophies where world_id = ${worldId}
    union all select no::int from fuses where world_id = ${worldId}
    order by no`;
  const [w] = await db()`select next_no::int from worlds where id = ${worldId}`;
  assert.equal(new Set(nos.map((f) => f.no)).size, nos.length, 'no number is used twice');
  assert.equal(nos[0]!.no, 1);
  assert.ok(nos.at(-1)!.no < w!.next_no, 'next_no is past every number used');
});
