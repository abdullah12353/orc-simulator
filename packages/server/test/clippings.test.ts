// #41 Clippings (D54, user stories 96–97): any Herald story cut into a shareable card, frozen as a
// snapshot (a later Humiliation never changes an old card), readable by every member of the world, and
// kept on the Hall of Shame's Clippings shelf, newest first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClipping, ClippingError, openEdition, type ClippingSnapshot } from '@orc/server';
import type { ClashLine } from '@orc/sim';
import { asUser, asUserCommitted, db, fakeClock, freshWorld, insertStoryFacts, newUser } from './support.ts';

type World = Awaited<ReturnType<typeof freshWorld>>;
type Clock = ReturnType<typeof fakeClock>;

async function joinAs(world: World, displayName: string) {
  const [inv] = await asUserCommitted(world.userId, (tx) => tx`select token from create_invite(${world.worldId})`);
  const userId = await newUser();
  const [row] = await asUserCommitted(userId, (tx) => tx`select join_world(${inv!.token}, ${displayName}) as id`);
  return { userId, playerId: row!.id as string };
}

/** A fresh world, its creator's first edition (day zero), and the Clash stories printed in it. */
async function worldWithEdition(clock: Clock) {
  const world = await freshWorld({ clock });
  const { edition } = await openEdition({ sql: db(), now: clock.now }, { userId: world.userId, worldId: world.worldId });
  const clashes = await db()<{ no: number; loser: string; a: string; b: string }[]>`
    select no::int, payload->>'loser' as loser, payload->>'a' as a, payload->>'b' as b from facts
    where world_id = ${world.worldId} and kind = 'clash' and no = any(${edition.stories.map((s) => s.storyNo)}::bigint[])`;
  assert.ok(clashes.length > 0, 'day zero printed a Clash');
  return { world, edition, clashes };
}

const clip = (clock: Clock, userId: string, worldId: string, editionId: string, storyNo: number) =>
  createClipping({ sql: db(), now: clock.now }, { userId, worldId, editionId, storyNo });

const readClippings = (userId: string, worldId: string) =>
  asUser(userId, (tx) => tx<{ id: string; story_no: number; snapshot: ClippingSnapshot }[]>`
    select id, story_no::int, snapshot from clippings where world_id = ${worldId} order by created_at`);

/** Gives a Captain a lost tusk (an overlay that always shows), as a new Fact and Humiliation row. */
async function loseTusk(worldId: string, captainId: string, at: string) {
  const [no] = await insertStoryFacts(worldId, at, [
    { minute: 0, kind: 'humiliation', tier: 'silent', line: '', payload: { captainId, cat: 'lost_bit', key: 'lost.tusk' } },
  ]);
  await db()`
    insert into humiliations (world_id, no, captain_id, cat, kind, gained_fact, gained_at)
    values (${worldId}, ${no!}, ${captainId}, 'lost_bit', 'lost.tusk', ${no!}, ${at})`;
}

const layerKeys = (snap: ClippingSnapshot, id: string) => snap.portraits.find((p) => p.captainId === id)!.face.layers.map((l) => l.key);

test("a clipped Clash quotes the loser's last line, with the headline and Blame line as printed", async () => {
  const clock = fakeClock();
  const { world, edition, clashes } = await worldWithEdition(clock);
  const clash = clashes[0]!;
  const printed = edition.stories.find((s) => s.storyNo === clash.no)!;
  const [dialogue] = await db()<{ lines: ClashLine[] }[]>`
    select lines from clash_dialogue where world_id = ${world.worldId} and fact_no = ${clash.no}`;

  const { snapshot } = await clip(clock, world.userId, world.worldId, edition.id, clash.no);

  const lastWord = dialogue!.lines.filter((l) => l.speaker === clash.loser).at(-1)!;
  assert.equal(snapshot.pullQuote?.speaker, clash.loser);
  assert.equal(snapshot.pullQuote?.text, lastWord.text);
  assert.equal(snapshot.headline, printed.headline);
  assert.equal(snapshot.blameLine, printed.blameLine);
  assert.deepEqual(snapshot.portraits.map((p) => p.captainId), [clash.a, clash.b]);
  assert.deepEqual(snapshot.edition, { id: edition.id, no: edition.no, orcDate: edition.masthead.orcDate });
});

test("a Clipping's snapshot is unchanged after its Captain later gains a Humiliation", async () => {
  const clock = fakeClock();
  const { world, edition, clashes } = await worldWithEdition(clock);
  const clash = clashes[0]!;
  const { id, snapshot } = await clip(clock, world.userId, world.worldId, edition.id, clash.no);
  assert.ok(!layerKeys(snapshot, clash.loser).includes('lost.tusk'), 'he still had both tusks');

  clock.advance(10);
  await loseTusk(world.worldId, clash.loser, clock.iso());

  const [stored] = (await readClippings(world.userId, world.worldId)).filter((c) => c.id === id);
  assert.deepEqual(stored!.snapshot, snapshot, 'the old card is frozen');
  assert.ok(!layerKeys(stored!.snapshot, clash.loser).includes('lost.tusk'));

  // Clipped again now, the card shows his face as it is now.
  const again = await clip(clock, world.userId, world.worldId, edition.id, clash.no);
  assert.ok(layerKeys(again.snapshot, clash.loser).includes('lost.tusk'));
});

test('any world member can read a Clipping; nobody outside the world can', async () => {
  const clock = fakeClock();
  const { world, edition, clashes } = await worldWithEdition(clock);
  const dazza = await joinAs(world, 'Dazza');
  const { id } = await clip(clock, world.userId, world.worldId, edition.id, clashes[0]!.no);

  const seen = await readClippings(dazza.userId, world.worldId);
  assert.deepEqual(seen.map((c) => c.id), [id]);
  assert.equal(seen[0]!.story_no, clashes[0]!.no);

  const outsider = await newUser();
  assert.equal((await readClippings(outsider, world.worldId)).length, 0);
  // Clients can't write Clippings directly: only through create-clipping.
  await assert.rejects(
    asUser(dazza.userId, (tx) => tx`insert into clippings (world_id, player_id, story_no, snapshot)
                                     values (${world.worldId}, ${dazza.playerId}, ${clashes[0]!.no}, '{}')`),
  );
});

test('only a story printed in your own edition can be clipped', async () => {
  const clock = fakeClock();
  const { world, edition, clashes } = await worldWithEdition(clock);
  const dazza = await joinAs(world, 'Dazza');
  const outsider = await newUser();
  const refused = async (p: Promise<unknown>, reason: string) =>
    assert.rejects(p, (e: unknown) => e instanceof ClippingError && e.message === reason);

  await refused(clip(clock, outsider, world.worldId, edition.id, clashes[0]!.no), 'not_a_player');
  await refused(clip(clock, dazza.userId, world.worldId, edition.id, clashes[0]!.no), 'not_in_edition');
  const [unprinted] = await insertStoryFacts(world.worldId, clock.iso(), [{ minute: 0, line: 'Never printed.' }]);
  await refused(clip(clock, world.userId, world.worldId, edition.id, unprinted!), 'not_in_edition');
  assert.equal((await readClippings(world.userId, world.worldId)).length, 0);
});

test('Clippings sit on the Hall shelf and in the timeline, newest first', async () => {
  const clock = fakeClock();
  const { world, edition } = await worldWithEdition(clock);
  const dazza = await joinAs(world, 'Dazza');
  // Clip three stories, in an order that isn't story order, so newest-first can't be story order.
  const stories = edition.stories.slice(0, 3);
  const order = [stories[1]!, stories[2]!, stories[0]!];
  const ids: string[] = [];
  for (const s of order) {
    clock.advance(5);
    ids.push((await clip(clock, world.userId, world.worldId, edition.id, s.storyNo)).id);
  }

  const shelf = await asUser(dazza.userId, (tx) => tx<{ clipping_id: string; fact_no: number; caption: string; clipped_by: string }[]>`
    select clipping_id, fact_no::int, caption, clipped_by from hall_clippings where world_id = ${world.worldId}`);
  assert.deepEqual(shelf.map((r) => r.clipping_id), [...ids].reverse());
  assert.deepEqual(shelf.map((r) => r.fact_no), [...order].reverse().map((s) => s.storyNo));
  assert.deepEqual(shelf.map((r) => r.caption), [...order].reverse().map((s) => s.headline));
  assert.ok(shelf.every((r) => r.clipped_by === 'Mo'));

  const timeline = await asUser(dazza.userId, (tx) => tx<{ shelf: string; clipping_id: string | null }[]>`
    select shelf, clipping_id from hall_timeline where world_id = ${world.worldId}`);
  assert.deepEqual(
    timeline.filter((r) => r.shelf === 'clipping').map((r) => r.clipping_id),
    [...ids].reverse(),
  );
  assert.equal(timeline[0]!.shelf, 'clipping', 'clipped after every story happened, so on top');

  const outsider = await newUser();
  assert.equal((await asUser(outsider, (tx) => tx`select 1 from hall_clippings where world_id = ${world.worldId}`)).length, 0);
});
