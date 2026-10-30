// #30 Clashes on the backend: Trophies and clash_dialogue are committed with the Facts (day zero and every
// tick), reaction Fuses and the variety record survive the round trip, and the world keeps stepping in
// the database exactly as it does in memory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content } from '@orc/content';
import { applyDiff, dayZero, fallbackDialogue, simulate, STARTING, stateHash, tickSeed, type ClashFact, type Fact, type WorldState } from '@orc/sim';
import { tickWorld } from '@orc/server';
import { asUser, db, fakeClock, freshWorld, newUser } from './support.ts';

const isClash = (f: Fact): f is ClashFact => f.kind === 'clash';

test('day zero commits a fallback dialogue for every Clash, and its Trophies, readable by members only', async () => {
  const clock = fakeClock();
  const createdAt = clock.iso();
  const { worldId, userId } = await freshWorld({ clock, seed: 404 });
  const { state, steps } = dayZero(content, 404, createdAt, worldId);
  const clashes = steps.flatMap((s) => s.facts).filter(isClash);
  assert.ok(clashes.length > 0, 'day zero has Clashes');

  const rows = await asUser(userId, (tx) => tx`
    select fact_no::int, lines, source, fallback_key from clash_dialogue where world_id = ${worldId} order by fact_no`);
  assert.deepEqual(
    rows.map((r) => [r.fact_no, r.lines, r.source, r.fallback_key]),
    clashes.map((c) => [c.no, fallbackDialogue(content, c), 'fallback', c.fallbackKey]),
  );

  const trophies = await asUser(userId, (tx) => tx`
    select no::int, kind, holder_id, taken_from_id, origin_fact::int from trophies where world_id = ${worldId} order by no`);
  assert.deepEqual(
    trophies.map((t) => [t.no, t.kind, t.holder_id, t.taken_from_id, t.origin_fact]),
    state.trophies.map((t) => [t.no, t.key, t.holder, t.takenFrom, t.origin.fact]),
  );

  const outsider = await newUser();
  for (const table of ['clash_dialogue', 'trophies']) {
    const seen = await asUser(outsider, (tx) => tx`select 1 from ${tx(table)} where world_id = ${worldId}`);
    assert.equal(seen.length, 0, `${table}: an outsider reads nothing`);
  }
  await assert.rejects(asUser(userId, (tx) => tx`update clash_dialogue set source = 'generated' where world_id = ${worldId}`), /permission denied/);
});

test('ticks commit Clashes, Trophies, reaction Fuses and dialogue, and step exactly like the sim in memory', async () => {
  const clock = fakeClock();
  const createdAt = clock.iso();
  const seed = 9090;
  const { worldId, playerId } = await freshWorld({ clock, seed });
  let { state } = dayZero(content, seed, createdAt, worldId);
  state = { ...state, players: { [playerId]: { gold: STARTING.gold, meddles: STARTING.meddles, firstMeddleDone: false, renderedFor: [] } } };

  // Every active pair hates the next one, in the database and in memory alike, so Clashes come thick and fast.
  const active = Object.keys(state.captains).filter((id) => state.captains[id]!.roster === 'active').sort();
  const feuds = active.map((id, i) => ({ holder: id, toward: active[(i + 1) % active.length]!, value: -95 }));
  await db()`
    insert into affinity (world_id, holder_id, toward_id, value, updated_at)
    select ${worldId}, a->>'holder', a->>'toward', (a->>'value')::smallint, ${createdAt}
    from jsonb_array_elements(${db().json(feuds)}) as a
    on conflict (world_id, holder_id, toward_id) do update set value = excluded.value`;
  state = { ...state, affinity: { ...state.affinity, ...Object.fromEntries(feuds.map((f) => [`${f.holder}>${f.toward}`, f.value])) } };

  const facts: Fact[] = [];
  let reactionFuses = 0;
  for (let i = 0; i < 24; i++) {
    clock.advance(5);
    const tickSeq = state.world.tickSeq + 1;
    const input: WorldState = { ...state, world: { ...state.world, tickSeq, prevTickAt: state.world.now, now: clock.iso() } };
    const { facts: expected, stateDiff } = simulate(input, [], tickSeed(seed, tickSeq));
    state = applyDiff(input, stateDiff);
    facts.push(...expected);
    reactionFuses += stateDiff.fuses.add.filter((f) => f.reaction).length;

    const out = await tickWorld({ sql: db(), now: clock.now }, worldId);
    assert.equal(out.status, 'stepped');
    if (out.status !== 'stepped') return;
    assert.equal(out.factCount, expected.length, `tick ${tickSeq}`);
    assert.equal(out.stateHash, stateHash(state), `tick ${tickSeq}: the database state matches memory`);
  }

  const clashes = facts.filter(isClash);
  assert.ok(clashes.length >= 5, `${clashes.length} Clashes`);
  const dialogue = await db()`
    select fact_no::int, lines, fallback_key from clash_dialogue
    where world_id = ${worldId} and fact_no = any(${clashes.map((c) => c.no)}::bigint[]) order by fact_no`;
  assert.deepEqual(
    dialogue.map((d) => [d.fact_no, d.lines, d.fallback_key]),
    clashes.map((c) => [c.no, fallbackDialogue(content, c), c.fallbackKey]),
  );
  const held = await db()`select no::int, holder_id from trophies where world_id = ${worldId} order by no`;
  assert.deepEqual(held.map((t) => [t.no, t.holder_id]), state.trophies.map((t) => [t.no, t.holder]));
  assert.ok(state.trophies.length > 0, 'some Trophies changed hands');
  const pending = await db()`select count(*)::int as n from fuses where world_id = ${worldId} and kind = 'reaction'`;
  assert.equal(pending[0]!.n, state.fuses.filter((f) => f.reaction).length, `${reactionFuses} reaction Fuses made`);
});
