// #35 Dares end to end: submit_intent debits a Meddle, the tick consumes (or rejects and refunds) it, the
// Fuse lands it as a Dare story with its Blame line in the Herald, and the DB state steps like memory.
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content } from '@orc/content';
import { openEdition, tickWorld } from '@orc/server';
import { applyDiff, dayZero, simulate, STARTING, stateHash, tickSeed, type Fact, type Intent, type WorldState } from '@orc/sim';
import { asUserCommitted, db, fakeClock, freshWorld } from './support.ts';

type Clock = ReturnType<typeof fakeClock>;
type World = Awaited<ReturnType<typeof freshWorld>>;

const failsWith = (reason: string) => (e: unknown) => {
  assert.equal((e as Error).message, reason);
  return true;
};

async function submit(userId: string, worldId: string, payload: unknown, id = randomUUID(), kind = 'dare') {
  const [row] = await asUserCommitted(userId, (tx) =>
    tx`select intent_id, meddles_left from submit_intent(${id}, ${worldId}, ${kind}, ${tx.json(payload as never)})`,
  );
  return { id, meddlesLeft: row!.meddles_left as number };
}

const meddlesAvailable = async (playerId: string) =>
  (await db()`select meddles_available from player_private where player_id = ${playerId}`)[0]!.meddles_available as number;

/** Two active Captains, neither the Warlord. */
async function pair(worldId: string) {
  const rows = await db()<{ id: string }[]>`
    select c.id from captains c join worlds w on w.id = c.world_id
    where c.world_id = ${worldId} and c.roster = 'active' and c.id is distinct from w.warlord_id order by c.id`;
  return { target: rows[0]!.id, victim: rows[1]!.id };
}

async function tick(world: World, clock: Clock, minutes = 5) {
  clock.advance(minutes);
  const out = await tickWorld({ sql: db(), now: clock.now }, world.worldId);
  assert.equal(out.status, 'stepped');
  return out;
}

test('a Dare debits one Meddle at once; resubmitting the same id does not debit again', async () => {
  const world = await freshWorld({ clock: fakeClock() });
  const { target, victim } = await pair(world.worldId);
  const first = await submit(world.userId, world.worldId, { target, dareKey: 'prank.frog-helmet', victim });
  assert.equal(first.meddlesLeft, 2);
  const again = await submit(world.userId, world.worldId, { target, dareKey: 'prank.frog-helmet', victim }, first.id);
  assert.equal(again.meddlesLeft, 2);
  assert.equal(await meddlesAvailable(world.playerId), 2);
  const [i] = await db()`select kind, payload from intents where id = ${first.id}`;
  assert.equal(i!.kind, 'dare');
  assert.deepEqual(i!.payload, { kind: 'dare', target, dareKey: 'prank.frog-helmet', victim, firstMeddle: false });
});

test('submit_intent refuses malformed Dares without debiting', async () => {
  const world = await freshWorld({ clock: fakeClock() });
  const { target, victim } = await pair(world.worldId);
  for (const bad of [
    { dareKey: 'stunt.torches' },
    { target, dareKey: '' },
    { target, dareKey: 7 },
    { target, dareKey: 'prank.frog-helmet', victim: target },
    { target, dareKey: 'prank.frog-helmet', victim: 3 },
    { target, dareKey: 'stunt.torches', firstMeddle: 'yes' },
  ]) {
    await assert.rejects(submit(world.userId, world.worldId, bad), failsWith('bad_dare'), JSON.stringify(bad));
  }
  await assert.rejects(submit(world.userId, world.worldId, { target, victim }, randomUUID(), 'gift'), failsWith('unsupported_kind'));
  assert.equal(await meddlesAvailable(world.playerId), 3);
});

test('the tick consumes a Dare into a pending Meddle on a Fuse; one the sim rejects is refunded', async () => {
  const clock = fakeClock();
  const world = await freshWorld({ clock });
  const { target, victim } = await pair(world.worldId);
  const good = await submit(world.userId, world.worldId, { target, dareKey: 'prank.frog-helmet', victim });
  const bad = await submit(world.userId, world.worldId, { target, dareKey: 'stunt.no-such-dare' });
  assert.equal(await meddlesAvailable(world.playerId), 1);

  await tick(world, clock);

  const intents = new Map((await db()`select id, status, reject_reason from intents where world_id = ${world.worldId}`).map((r) => [r.id, r]));
  assert.equal(intents.get(good.id)!.status, 'consumed');
  assert.equal(intents.get(bad.id)!.status, 'rejected');
  assert.equal(intents.get(bad.id)!.reject_reason, 'bad_dare');
  assert.equal(await meddlesAvailable(world.playerId), 2, 'the rejected Dare came back');

  const [m] = await db()`select verb, status, target_id, victim_id, dare_key, landed_fact from meddles where id = ${good.id}`;
  assert.deepEqual({ ...m }, { verb: 'dare', status: 'pending', target_id: target, victim_id: victim, dare_key: 'prank.frog-helmet', landed_fact: null });
  const [f] = await db()`
    select extract(epoch from due_at - ${clock.iso()}::timestamptz)::int / 60 as minutes from fuses where meddle_id = ${good.id}`;
  assert.ok(f!.minutes >= 10 && f!.minutes <= 90, `${f!.minutes} min`);
});

test('a landed Dare is a story in my next edition, with its Blame line', async () => {
  const clock = fakeClock();
  const world = await freshWorld({ clock });
  await openEdition({ sql: db(), now: clock.now }, world);
  const { target } = await pair(world.worldId);
  const { id } = await submit(world.userId, world.worldId, { target, dareKey: 'stunt.torches' });
  await tick(world, clock);
  await tick(world, clock, 95);
  const [m] = await db()`select status::text, landed_fact::int from meddles where id = ${id}`;
  assert.equal(m!.status, 'landed');
  const [head] = await db()`select kind, line, payload from facts where world_id = ${world.worldId} and no = ${m!.landed_fact}`;
  assert.equal(head!.kind, 'dare');
  assert.equal(head!.payload.target, target);
  const [blame] = await db()`select verb::text, hops from fact_blame where world_id = ${world.worldId} and fact_no = ${m!.landed_fact}`;
  assert.deepEqual({ ...blame }, { verb: 'dare', hops: 0 });

  const out = await openEdition({ sql: db(), now: clock.now }, world);
  const story = out.edition.stories.find((s) => s.storyNo === m!.landed_fact);
  assert.ok(story, 'the Dare is in the edition');
  assert.equal(story.headline, head!.line);
  assert.match(story.blameLine ?? '', /set a Dare/);
});

test('Dares (a Prank and a surprise) commit and reload exactly like the sim in memory', async () => {
  const clock = fakeClock();
  const createdAt = clock.iso();
  // The first seed from 3535 where all three Dares land (the Prank not refused, so its Grudge tag is checked);
  // with the v1 catalogue 3535 kills the target first. 3536 also plays all three outcomes.
  const seed = 3536;
  const { worldId, playerId, userId } = await freshWorld({ clock, seed });
  let { state } = dayZero(content, seed, createdAt, worldId);
  state = { ...state, players: { [playerId]: { gold: STARTING.gold, meddles: STARTING.meddles, firstMeddleDone: false, renderedFor: [] } } };
  const { target, victim } = await pair(worldId);

  const plant = async (payload: Record<string, unknown>): Promise<Intent> => {
    const id = randomUUID();
    await submit(userId, worldId, payload, id);
    const [row] = await db()<{ created_at: string; payload: Record<string, unknown> }[]>`
      select to_json(created_at)#>>'{}' as created_at, payload from intents where id = ${id}`;
    const p = state.players[playerId]!;
    state = { ...state, players: { [playerId]: { ...p, meddles: p.meddles - 1 } } };
    return { ...row!.payload, id, playerId, at: new Date(row!.created_at).toISOString() } as Intent;
  };
  const intents = [
    await plant({ target, dareKey: 'prank.frog-helmet', victim }),
    await plant({ target: victim, dareKey: 'surprise' }),
    await plant({ target, dareKey: 'stunt.battlements' }),
  ];

  const facts: Fact[] = [];
  for (let i = 0; i < 12; i++) {
    clock.advance(i === 0 ? 5 : 15);
    const tickSeq = state.world.tickSeq + 1;
    const input: WorldState = { ...state, world: { ...state.world, tickSeq, prevTickAt: state.world.now, now: clock.iso() } };
    const { facts: expected, stateDiff } = simulate(input, i === 0 ? intents : [], tickSeed(seed, tickSeq));
    state = applyDiff(input, stateDiff);
    facts.push(...expected);
    const out = await tickWorld({ sql: db(), now: clock.now }, worldId);
    assert.equal(out.status, 'stepped');
    if (out.status !== 'stepped') return;
    assert.equal(out.factCount, expected.length, `tick ${tickSeq}`);
    assert.equal(out.stateHash, stateHash(state), `tick ${tickSeq}: the database state matches memory`);
  }
  const dares = facts.filter((f) => f.kind === 'dare');
  for (const intent of intents) {
    const landed = dares.some((f) => f.kind === 'dare' && f.meddleId === intent.id);
    assert.ok(landed || state.meddles[intent.id]?.status === 'held', `${intent.id} landed, or waits for a dead Captain`);
  }
  assert.ok(dares.length >= 2, `${dares.length} Dares landed`);

  // The Prank's Grudge tag is in the DB, caused by the Dare.
  const prank = dares.find((f) => f.kind === 'dare' && f.meddleId === intents[0]!.id);
  assert.ok(prank, 'the Prank landed');
  if (prank.kind === 'dare' && prank.outcome !== 'refused') {
    const tags = await db()`
      select tag, cause_fact::int from grudge_tags where world_id = ${worldId} and holder_id = ${victim} and toward_id = ${target}`;
    assert.ok(tags.some((t) => t.cause_fact === prank.no && t.tag === 'put a frog in his helmet'));
  }
});
