// #42 Pushes: the tick's commit layer queues `push_jobs` for deaths, Returns, Warlord changes and Legendary
// deeds touching a Player's Stable, and for the Player's own Meddles' heads with weight >= 15. At most 3 a
// London day, none in quiet hours (23:00–08:00 Europe/London); the dropped ones are logged. Never gold.
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Fact } from '@orc/sim';
import { content } from '@orc/content';
import { pushText, queuePushes, tickWorld } from '@orc/server';
import { asUser, asUserCommitted, db, fakeClock, freshWorld, insertStoryFacts, newUser, type StoryFact } from './support.ts';

type Clock = ReturnType<typeof fakeClock>;
type World = Awaited<ReturnType<typeof freshWorld>> & { clock: Clock };

async function world(start?: string): Promise<World> {
  const clock = fakeClock(start);
  return { ...(await freshWorld({ clock })), clock };
}

async function secondPlayer(w: World, name = 'Haris') {
  const [inv] = await asUserCommitted(w.userId, (tx) => tx`select token from create_invite(${w.worldId})`);
  const userId = await newUser();
  const [row] = await asUserCommitted(userId, (tx) => tx`select join_world(${inv!.token}, ${name}) as id`);
  return { userId, playerId: row!.id as string };
}

/** Opts a Player in to pushes on one (fake) device, the way the PWA does. */
async function subscribe(w: { worldId: string }, userId: string, endpoint = `https://push.test/${randomUUID()}`) {
  await asUserCommitted(userId, (tx) => tx`select subscribe_push(${w.worldId}, ${endpoint}, 'p256dh-key', 'auth-secret')`);
  return endpoint;
}

async function back(w: { worldId: string }, playerId: string, captainId: string) {
  await db()`
    insert into stakes (world_id, player_id, captain_id, amount, created_at, updated_at)
    values (${w.worldId}, ${playerId}, ${captainId}, 5, now(), now())`;
}

async function captainIds(worldId: string): Promise<string[]> {
  return (await db()<{ id: string }[]>`select id from captains where world_id = ${worldId} order by id`).map((c) => c.id);
}

/** Appends hand-made Facts at the clock's time and returns them as the tick would hand them over. */
async function facts(w: World, list: StoryFact[]): Promise<Fact[]> {
  const nos = await insertStoryFacts(w.worldId, w.clock.iso(), list);
  const rows = await db()<{ payload: Fact }[]>`
    select payload from facts where world_id = ${w.worldId} and no = any(${nos}::bigint[]) order by no`;
  return rows.map((r) => r.payload);
}

/** Runs the commit layer's push step for these Facts, in a transaction like the tick's. */
async function queue(w: World, list: Fact[]) {
  await db().begin((tx) => queuePushes(tx, w.worldId, list, w.clock.iso()));
}

async function pushesFor(playerId: string) {
  return db()<{ fact_no: number; status: string; title: string; text: string }[]>`
    select fact_no::int, status::text, title, text from push_jobs where player_id = ${playerId} order by id`;
}

/** A Clash whose loser died: the head plus its silent death consequence. */
function clashWithDeath(loser: string): StoryFact[] {
  return [
    { minute: 0, kind: 'clash', weight: 30, line: `${loser} lost a Clash and the moat won.` },
    { minute: 0, consequenceOf: 0, kind: 'death', tier: 'silent', payload: { captainId: loser, causeTag: 'sank' } },
  ];
}

test("a death of a Captain I back pushes to me and not to a Player who doesn't back him", async () => {
  const w = await world();
  const other = await secondPlayer(w);
  const [, victim, bystander] = await captainIds(w.worldId);
  await back(w, w.playerId, victim!);
  await back(w, other.playerId, bystander!);
  await subscribe(w, w.userId);
  await subscribe(w, other.userId);

  const list = await facts(w, clashWithDeath(victim!));
  await queue(w, list);

  const mine = await pushesFor(w.playerId);
  assert.deepEqual(mine.map((p) => [p.fact_no, p.status]), [[list[0]!.no, 'queued']], 'one push, about the story');
  assert.match(mine[0]!.text, /moat won/);
  assert.equal((await pushesFor(other.playerId)).length, 0, 'not to a Player who backs someone else');
});

test('a 4th qualifying push in a London day is dropped as dropped_cap', async () => {
  const w = await world('2026-10-30T09:00:00.000Z');
  const ids = await captainIds(w.worldId);
  for (const id of ids.slice(0, 4)) await back(w, w.playerId, id);
  await subscribe(w, w.userId);

  // Four ticks, an hour apart, each killing one of my Captains.
  for (const id of ids.slice(0, 4)) {
    await queue(w, await facts(w, clashWithDeath(id)));
    w.clock.advance(60);
  }
  assert.deepEqual(
    (await pushesFor(w.playerId)).map((p) => p.status),
    ['queued', 'queued', 'queued', 'dropped_cap'],
  );
});

test('the daily count resets at the London day roll', async () => {
  const w = await world('2026-10-30T20:00:00.000Z');
  const ids = await captainIds(w.worldId);
  for (const id of ids.slice(0, 4)) await back(w, w.playerId, id);
  await subscribe(w, w.userId);
  for (const id of ids.slice(0, 3)) await queue(w, await facts(w, clashWithDeath(id)));

  w.clock.advance(13 * 60); // 09:00 the next London day
  await queue(w, await facts(w, clashWithDeath(ids[3]!)));
  assert.deepEqual(
    (await pushesFor(w.playerId)).map((p) => p.status),
    ['queued', 'queued', 'queued', 'queued'],
  );
});

test('a push at 23:30 London time is dropped as dropped_quiet', async () => {
  // 22:30 UTC in July is 23:30 in London (BST).
  const w = await world('2026-07-01T22:30:00.000Z');
  const [, victim] = await captainIds(w.worldId);
  await back(w, w.playerId, victim!);
  await subscribe(w, w.userId);

  await queue(w, await facts(w, clashWithDeath(victim!)));
  assert.deepEqual((await pushesFor(w.playerId)).map((p) => p.status), ['dropped_quiet']);
});

test('quiet hours end at 08:00 London time', async () => {
  const w = await world('2026-07-01T07:00:00.000Z'); // 08:00 BST
  const [, victim] = await captainIds(w.worldId);
  await back(w, w.playerId, victim!);
  await subscribe(w, w.userId);

  await queue(w, await facts(w, clashWithDeath(victim!)));
  assert.deepEqual((await pushesFor(w.playerId)).map((p) => p.status), ['queued']);
});

/** A head my Meddle landed as (its hop-0 Blame names me), at this comedy weight. */
function myMeddleHead(playerId: string, weight: number): StoryFact[] {
  const blame = [{ meddleId: randomUUID(), playerId, verb: 'rumour', landedFact: -1, landedAt: '', hops: 0 }];
  return [{ minute: 0, kind: 'rumour', weight, line: `A Rumour weighing ${weight} landed.`, payload: { blame } }];
}

async function meddleFacts(w: World, playerId: string, weight: number): Promise<Fact[]> {
  const list = await facts(w, myMeddleHead(playerId, weight));
  // The landing is the head itself.
  return list.map((f) => ({ ...f, blame: f.blame.map((b) => ({ ...b, landedFact: f.no, landedAt: f.at })) }));
}

test("my Meddle's story at weight 14 doesn't push; at 15 it does", async () => {
  const w = await world();
  const other = await secondPlayer(w);
  await subscribe(w, w.userId);
  await subscribe(w, other.userId);

  await queue(w, await meddleFacts(w, w.playerId, 14));
  assert.equal((await pushesFor(w.playerId)).length, 0, 'weight 14: no push');

  const fifteen = await meddleFacts(w, w.playerId, 15);
  await queue(w, fifteen);
  assert.deepEqual((await pushesFor(w.playerId)).map((p) => [p.fact_no, p.status]), [[fifteen[0]!.no, 'queued']]);
  assert.equal((await pushesFor(other.playerId)).length, 0, "not to a Player whose Meddle it isn't");
});

test('a Player with no device opted in gets no push rows', async () => {
  const w = await world();
  const [, victim] = await captainIds(w.worldId);
  await back(w, w.playerId, victim!);
  await queue(w, await facts(w, clashWithDeath(victim!)));
  assert.equal((await pushesFor(w.playerId)).length, 0);
});

test('push text never mentions gold', async () => {
  const w = await world();
  const [, victim] = await captainIds(w.worldId);
  await back(w, w.playerId, victim!);
  await subscribe(w, w.userId);
  const list = await facts(w, [
    { minute: 0, kind: 'incident', weight: 30, line: `${victim} sank under 30 GOLD coins.` },
    { minute: 0, consequenceOf: 0, kind: 'death', tier: 'silent', payload: { captainId: victim, causeTag: 'sank' } },
  ]);
  await queue(w, list);
  const [push] = await pushesFor(w.playerId);
  assert.ok(push, 'the death still pushes');
  assert.doesNotMatch(`${push.title} ${push.text}`, /gold/i);

  // Every title, for every reason and Captain, and the plain fallback line.
  for (const reason of ['death', 'return', 'warlord_fell', 'crowned', 'legendary', 'meddle'] as const) {
    for (const c of content.cast) {
      const t = pushText(content, reason, c.id, 'Your gold went up by 8.');
      assert.doesNotMatch(`${t.title} ${t.text}`, /gold/i, `${reason} / ${c.id}`);
    }
  }
});

test('the tick queues pushes for Stable events in the Facts it commits', async () => {
  const w = await world('2026-10-30T08:00:00.000Z');
  for (const id of await captainIds(w.worldId)) await back(w, w.playerId, id);
  await subscribe(w, w.userId);

  // Unwatched, so a tick every 5 minutes, until some Stable event happens (a death is ~5 a day).
  let pushes: { fact_no: number }[] = [];
  for (let n = 0; n < 200 && pushes.length === 0; n++) {
    w.clock.advance(5);
    const out = await tickWorld({ sql: db(), now: w.clock.now }, w.worldId);
    assert.equal(out.status, 'stepped');
    pushes = await pushesFor(w.playerId);
  }
  assert.ok(pushes.length > 0, 'some Stable event pushed within 200 ticks');
  const [story] = await db()<{ kinds: string[] }[]>`
    select array_agg(kind order by no) as kinds from facts where world_id = ${w.worldId} and story_no = ${pushes[0]!.fact_no}`;
  assert.ok(
    story!.kinds.some((k) => ['death', 'return', 'warlord_fell', 'crowned', 'legendary'].includes(k)),
    `the pushed story has a Stable event: ${story!.kinds.join(', ')}`,
  );
});
