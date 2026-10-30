// #29 Blame: the tick writes the causal edges (fact_causes) and the materialised Blame (fact_blame),
// loads a Grudge tag's Cause back with its Blame, and the Herald prints a templated Blame line.
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content } from '@orc/content';
import { insertFacts, loadCauses, openEdition, tickWorld } from '@orc/server';
import { chain, type BlameEntry, type Fact } from '@orc/sim';
import { asUser, asUserCommitted, db, fakeClock, freshWorld, newUser } from './support.ts';

type Clock = ReturnType<typeof fakeClock>;
type World = Awaited<ReturnType<typeof freshWorld>>;

async function pair(worldId: string, skip = 0) {
  const rows = await db()<{ id: string; traits: string[] }[]>`
    select id, traits from captains where world_id = ${worldId} and roster = 'active' order by id`;
  const source = rows[skip % rows.length]!;
  const target = rows[(skip + 1) % rows.length]!;
  return { source: source.id, target: target.id, trait: target.traits[0]! };
}

async function joinAs(world: World, displayName: string) {
  const [inv] = await asUserCommitted(world.userId, (tx) => tx`select token from create_invite(${world.worldId})`);
  const userId = await newUser();
  const [row] = await asUserCommitted(userId, (tx) => tx`select join_world(${inv!.token}, ${displayName}) as id`);
  return { userId, playerId: row!.id as string };
}

async function tick(world: World, clock: Clock, minutes = 5) {
  clock.advance(minutes);
  const out = await tickWorld({ sql: db(), now: clock.now }, world.worldId);
  assert.equal(out.status, 'stepped');
  return out;
}

/** Plants a Rumour as `userId` and ticks until it lands. Returns its landing Fact. */
async function landRumour(world: World, clock: Clock, userId: string, skip: number): Promise<Fact> {
  const p = await pair(world.worldId, skip);
  const id = randomUUID();
  const payload = { source: p.source, target: p.target, claim: 'insult', subject: { from: 'trait', key: p.trait } };
  await asUserCommitted(userId, (tx) => tx`select * from submit_intent(${id}, ${world.worldId}, 'rumour', ${tx.json(payload)})`);
  await tick(world, clock);
  await tick(world, clock, 95);
  const [m] = await db()`select landed_fact::int from meddles where id = ${id}`;
  assert.ok(m?.landed_fact, 'the Rumour landed');
  const [f] = await db()`select payload from facts where world_id = ${world.worldId} and no = ${m.landed_fact}`;
  return f!.payload as Fact;
}

test('the tick writes fact_blame and fact_causes for a landed Rumour, readable by world members', async () => {
  const clock = fakeClock();
  const world = await freshWorld({ clock });
  const head = await landRumour(world, clock, world.userId, 0);
  const meddleId = head.kind === 'rumour' ? head.meddleId : '';

  const [grudge] = await db()`
    select no::int from facts where world_id = ${world.worldId} and story_no = ${head.no} and kind = 'grudge'`;
  // Only this story: a Hothead hearer would carry the Blame on into a Clash of its own.
  const blame = await asUser(world.userId, (tx) => tx`
    select fact_no::int, meddle_id, player_id, verb, landed_fact::int, landed_at, hops
    from fact_blame where world_id = ${world.worldId} and fact_no in (${head.no}, ${grudge!.no}) order by fact_no`);
  assert.deepEqual(
    blame.map((b) => [b.fact_no, b.meddle_id, b.player_id, b.verb, b.landed_fact, new Date(b.landed_at).toISOString(), b.hops]),
    [
      [head.no, meddleId, world.playerId, 'rumour', head.no, head.at, 0],
      [grudge!.no, meddleId, world.playerId, 'rumour', head.no, head.at, 0],
    ],
  );
  const causes = await asUser(world.userId, (tx) => tx`
    select fact_no::int, cause_no::int from fact_causes where world_id = ${world.worldId} and fact_no in (${head.no}, ${grudge!.no})`);
  assert.deepEqual(causes.map((c) => [c.fact_no, c.cause_no]), [[grudge!.no, head.no]]);

  const outsider = await newUser();
  assert.equal((await asUser(outsider, (tx) => tx`select 1 from fact_blame where world_id = ${world.worldId}`)).length, 0);
  assert.equal((await asUser(outsider, (tx) => tx`select 1 from fact_causes where world_id = ${world.worldId}`)).length, 0);
  await assert.rejects(db()`update fact_blame set hops = 2 where world_id = ${world.worldId}`, /append-only/);
});

test("a Grudge tag's Cause loads back with the Blame of the Fact that caused it", async () => {
  const clock = fakeClock();
  const world = await freshWorld({ clock });
  const head = await landRumour(world, clock, world.userId, 2);
  const causes = await db().begin((tx) => loadCauses(tx, world.worldId, [head.no]));
  assert.deepEqual(causes.get(head.no), { fact: head.no, blame: head.blame });
  // The next tick loads the tag with that Cause (loadState uses loadCauses) and steps cleanly.
  await tick(world, clock);
});

test('Blame lines in an edition name Players in landing order', async () => {
  const clock = fakeClock();
  const world = await freshWorld({ clock }); // the creator is "Mo"
  const dazza = await joinAs(world, 'Dazza');
  const kev = await joinAs(world, 'Kev');
  await openEdition({ sql: db(), now: clock.now }, world); // Mo's edition #1: day zero

  // Dazza's lands first, then Mo's, then Kev's, whatever order they joined in.
  const heads = [
    await landRumour(world, clock, dazza.userId, 0),
    await landRumour(world, clock, world.userId, 2),
    await landRumour(world, clock, kev.userId, 4),
  ];

  // A story that needed all three Grudges (what a Clash will be): Blame one hop on from each.
  clock.advance(1);
  const linked = chain({ requires: heads.map((h) => ({ fact: h.no, blame: h.blame })) });
  const [w] = await db()`select next_no::int, tick_seq::int from worlds where id = ${world.worldId}`;
  const story: Fact = {
    no: w!.next_no,
    at: clock.iso(),
    storyNo: w!.next_no,
    line: 'Three Grudges walk into a bar.',
    tier: 'templated',
    cast: [],
    ...linked,
    infamy: [],
    comedyWeight: 99,
    kind: 'incident',
    trigger: 'reaction',
    roles: {},
    outcomeKey: 'brawl',
  };
  await db().begin(async (tx) => {
    await insertFacts(tx, world.worldId, [{ tickSeq: w!.tick_seq, fact: story }], content);
    await tx`update worlds set next_no = next_no + 1 where id = ${world.worldId}`;
  });
  assert.deepEqual(
    linked.blame.map((b: BlameEntry) => b.hops),
    [1, 1, 1],
  );

  const out = await openEdition({ sql: db(), now: clock.now }, world);
  assert.equal(out.created, true);
  assert.equal(out.reader, 'Mo', 'the client highlights the reader');
  const lines = new Map(out.edition.stories.map((s) => [s.storyNo, s.blameLine]));
  assert.equal(
    lines.get(story.no),
    "It all began when Dazza planted a Rumour, Mo's Rumour kept it going, and Kev's Rumour finished the job.",
  );
  assert.equal(lines.get(heads[0]!.no), 'It all began when Dazza planted a Rumour.');
  assert.equal(lines.get(heads[2]!.no), 'It all began when Kev planted a Rumour.');
  // Anything else gets a line only if it carries Blame (a Clash over one of those Grudges would).
  const blamed = new Set(
    (await db()`select distinct fact_no::int from fact_blame where world_id = ${world.worldId}`).map((r) => r.fact_no),
  );
  for (const s of out.edition.stories) assert.equal(s.blameLine !== null, blamed.has(s.storyNo), `story ${s.storyNo}: no Blame, no line`);

  // Stored with the edition: reopening (nothing new, so no new edition) shows the same lines.
  const again = await openEdition({ sql: db(), now: clock.now }, world);
  assert.equal(again.created, false);
  assert.deepEqual(
    again.edition.stories.map((s) => [s.storyNo, s.blameLine]),
    out.edition.stories.map((s) => [s.storyNo, s.blameLine]),
  );
});
