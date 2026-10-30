// #27 The templated Herald: open-edition (data-model §4.1) and the owner-only editions tables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content } from '@orc/content';
import { dayZero } from '@orc/sim';
import { openEdition, OpenEditionError } from '@orc/server';
import { asUser, asUserCommitted, db, fakeClock, freshWorld, insertStoryFacts, newUser } from './support.ts';

const HOUR_MS = 3600_000;
const iso = (d: Date | string | number) => new Date(d).toISOString();

async function open(world: { worldId: string; userId: string }, clock: ReturnType<typeof fakeClock>) {
  return openEdition({ sql: db(), now: clock.now }, { userId: world.userId, worldId: world.worldId });
}

async function editionCount(playerId: string): Promise<number> {
  const [r] = await db()`select count(*)::int as n from editions where player_id = ${playerId}`;
  return r!.n;
}

test("a Player's first open produces edition #1 covering day zero", async () => {
  const clock = fakeClock();
  const createdAt = clock.iso();
  const world = await freshWorld({ clock, seed: 77 });
  const { steps } = dayZero(content, 77, createdAt, world.worldId);
  const heads = steps.flatMap((s) => s.facts).filter((f) => f.no === f.storyNo && f.tier !== 'silent');
  assert.ok(heads.length >= 10, `seed 77 makes ${heads.length} heads`);

  const out = await open(world, clock);
  assert.equal(out.created, true);
  assert.deepEqual(out.stopPress, []);
  const ed = out.edition;
  assert.equal(ed.no, 1);
  assert.equal(iso(ed.coversFrom), iso(Date.parse(createdAt) - 24 * HOUR_MS), 'from the start of day zero');
  assert.equal(iso(ed.coversTo), createdAt);
  assert.equal(ed.status, 'templated');
  for (const field of ['orcDate', 'price', 'weather'] as const) {
    assert.ok(typeof ed.masthead[field] === 'string' && ed.masthead[field].length > 0, `masthead ${field}`);
  }

  assert.equal(ed.stories.length, Math.min(28, heads.length));
  const byNo = new Map(heads.map((h) => [h.no, h]));
  for (const s of ed.stories) {
    const head = byNo.get(s.storyNo);
    assert.ok(head, `story ${s.storyNo} is a day-zero head`);
    assert.equal(s.headline, head.line, 'the templated headline is the line');
  }
  assert.deepEqual(ed.stories.map((s) => s.rank), ed.stories.map((_, i) => i + 1));
  assert.equal(ed.stories[0]!.slot, 'lead');
  assert.equal(byNo.get(ed.stories[0]!.storyNo)!.comedyWeight, Math.max(...heads.map((h) => h.comedyWeight!)));

  const [priv] = await db()`select last_edition_no from player_private where player_id = ${world.playerId}`;
  assert.equal(priv!.last_edition_no, 1);
  assert.equal(await editionCount(world.playerId), 1);
});

test('reopening with fewer than 3 new stories inside 30 min gives the last edition plus a Stop press', async () => {
  const clock = fakeClock();
  const t0 = clock.iso();
  const world = await freshWorld({ clock });
  const first = await open(world, clock);

  const [a, b] = await insertStoryFacts(world.worldId, t0, [
    { minute: 5, weight: 4, line: 'Krúg fell in the moat again.' },
    { minute: 10, weight: 9, line: 'Gorbag sat on a hedgehog.' },
    { minute: 11, weight: 30, tier: 'silent' },
    { minute: 12, consequenceOf: 0 },
  ]);

  clock.advance(20);
  const again = await open(world, clock);
  assert.equal(again.created, false, 'no new edition is due');
  assert.equal(again.edition.id, first.edition.id, 'the last edition comes back');
  assert.deepEqual(
    again.stopPress.map((s) => [s.storyNo, s.line]),
    [
      [b, 'Gorbag sat on a hedgehog.'],
      [a, 'Krúg fell in the moat again.'],
    ],
    'the new stories as lines, heaviest first; no silent Facts and no consequences',
  );
  assert.equal(await editionCount(world.playerId), 1);

  clock.advance(11); // 31 min since edition #1
  const later = await open(world, clock);
  assert.equal(later.created, true, '1 or more new stories and 30 min since the last edition');
  assert.equal(later.edition.no, 2);
  assert.equal(iso(later.edition.coversFrom), t0, "the window starts at the last edition's end");
  assert.equal(iso(later.edition.coversTo), clock.iso());
  assert.deepEqual(later.edition.stories.map((s) => s.storyNo), [b, a]);
  assert.deepEqual(later.stopPress, []);

  // Nothing new since: the Stop press is empty and edition #2 stands.
  clock.advance(45);
  const quiet = await open(world, clock);
  assert.equal(quiet.created, false);
  assert.equal(quiet.edition.no, 2);
  assert.deepEqual(quiet.stopPress, []);

  // Every edition is kept, unchanged.
  const all = await db()`select no from editions where player_id = ${world.playerId} order by no`;
  assert.deepEqual(all.map((e) => e.no), [1, 2]);
  const kept = await db()`select count(*)::int as n from edition_stories where edition_id = ${first.edition.id}`;
  assert.equal(kept[0]!.n, first.edition.stories.length);
});

test('3 new stories make a new edition at once', async () => {
  const clock = fakeClock();
  const t0 = clock.iso();
  const world = await freshWorld({ clock });
  await open(world, clock);
  await insertStoryFacts(world.worldId, t0, [{ minute: 1 }, { minute: 2 }, { minute: 3 }]);
  clock.advance(5);
  const out = await open(world, clock);
  assert.equal(out.created, true);
  assert.equal(out.edition.no, 2);
  assert.equal(out.edition.stories.length, 3);
});

test('stories rank Legendary deed first, then weight, then newest, then number; lead, 7 headlines, 20 in the gutter', async () => {
  const clock = fakeClock();
  const t0 = clock.iso();
  const world = await freshWorld({ clock });
  await open(world, clock);

  const fillers = Array.from({ length: 25 }, (_, i) => ({ minute: 10 + i, weight: 2 })); // indices 8..32
  const nos = await insertStoryFacts(world.worldId, t0, [
    { minute: 1, weight: 5 }, // 0
    { minute: 2, weight: 12 }, // 1
    { minute: 3, weight: 12 }, // 2: same weight as 1 but newer
    { minute: 4, weight: 3 }, // 3: the Legendary deed, light as it is
    { minute: 4, kind: 'legendary', consequenceOf: 3, deed: 3 }, // 4
    { minute: 5, weight: 20, tier: 'silent' }, // 5: silent, never a story
    { minute: 6, weight: 9 }, // 6
    { minute: 6, weight: 9 }, // 7: same weight and time as 6, higher number
    ...fillers,
    { minute: 40, consequenceOf: 1 }, // 33: a consequence, never a story
  ]);

  clock.advance(45);
  const out = await open(world, clock);
  assert.equal(out.created, true);
  const fillerOrder = Array.from({ length: 22 }, (_, i) => 32 - i); // newest filler first, 32 down to 11
  const expected = [3, 2, 1, 6, 7, 0, ...fillerOrder].map((i) => nos[i]);
  const stories = out.edition.stories;
  assert.deepEqual(stories.map((s) => s.storyNo), expected, '28 stories; the rest fall through');
  assert.deepEqual(stories.map((s) => s.rank), expected.map((_, i) => i + 1));
  assert.deepEqual(
    stories.map((s) => s.slot),
    ['lead', ...Array(7).fill('headline'), ...Array(20).fill('gutter')],
  );
  assert.ok(stories.filter((s) => s.slot !== 'gutter').length <= 8, 'never more than 8 stories in full');

  // The stored edition matches what open-edition returned.
  const rows = await db()`
    select rank, story_no::int, slot from edition_stories where edition_id = ${out.edition.id} order by rank`;
  assert.deepEqual(rows.map((r) => [r.rank, r.story_no, r.slot]), stories.map((s) => [s.rank, s.storyNo, s.slot]));
});

test("another Player can't read my editions, and outsiders can't open one", async () => {
  const clock = fakeClock();
  const world = await freshWorld({ clock });
  const mine = await open(world, clock);

  const [inv] = await asUserCommitted(world.userId, (tx) => tx`select token from create_invite(${world.worldId})`);
  const friend = await newUser();
  await asUserCommitted(friend, (tx) => tx`select join_world(${inv!.token}, 'Dazza')`);

  const read = (user: string) =>
    asUser(user, async (tx) => ({
      editions: (await tx`select id from editions where world_id = ${world.worldId}`).length,
      stories: (await tx`select rank from edition_stories where edition_id = ${mine.edition.id}`).length,
    }));
  const me = await read(world.userId);
  assert.equal(me.editions, 1);
  assert.equal(me.stories, mine.edition.stories.length);
  assert.deepEqual(await read(friend), { editions: 0, stories: 0 });

  await assert.rejects(
    asUser(friend, (tx) => tx`update editions set status = 'generated' where id = ${mine.edition.id}`),
    /permission denied/,
  );

  const outsider = await newUser();
  await assert.rejects(
    openEdition({ sql: db(), now: clock.now }, { userId: outsider, worldId: world.worldId }),
    (e) => e instanceof OpenEditionError && e.message === 'not_a_player',
  );
});
