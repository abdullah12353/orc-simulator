// #34 Infamy, the Warlord and Legendary through the database: gains recorded per Fact (`infamy_gains`),
// the 7-day window, the throne changing hands in a tick, and the Herald leading with a Legendary deed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content } from '@orc/content';
import { dayZero } from '@orc/sim';
import { openEdition, tickWorld } from '@orc/server';
import { asUser, db, fakeClock, freshWorld, insertStoryFacts, newUser } from './support.ts';

type World = Awaited<ReturnType<typeof freshWorld>>;

/** Ticks a watched world a minute at a time until a Fact of `kind` turns up (or gives up). */
async function tickUntil(world: World, clock: ReturnType<typeof fakeClock>, kind: string, max = 200) {
  for (let i = 0; i < max; i++) {
    clock.advance(1);
    await db()`update player_private set last_seen_at = ${clock.iso()} where player_id = ${world.playerId}`;
    const out = await tickWorld({ sql: db(), now: clock.now }, world.worldId);
    assert.equal(out.status, 'stepped');
    if (out.status !== 'stepped') break;
    const facts = await db()<{ no: number; story_no: number; payload: Record<string, unknown> }[]>`
      select no::int, story_no::int, payload from facts
      where world_id = ${world.worldId} and tick_seq = ${out.tickSeq} and kind = ${kind} order by no`;
    if (facts.length > 0) return { tickSeq: out.tickSeq, facts };
  }
  throw new Error(`no ${kind} Fact in ${max} ticks`);
}

test('day zero records every Infamy gain per Fact; Captains carry the lifetime totals; members read the 7-day window', async () => {
  // The 7-day view reads the real clock, so this world is created (and day zero runs) up to now.
  const clock = fakeClock(new Date(Date.now() - 60_000).toISOString());
  const createdAt = clock.iso();
  const world = await freshWorld({ clock, seed: 404 });
  const { state, steps } = dayZero(content, 404, createdAt, world.worldId);
  const expected = steps
    .flatMap((s) => s.facts)
    .flatMap((f) => f.infamy.map((g) => [f.no, g.captainId, g.amount]))
    .sort((a, b) => (a[0] as number) - (b[0] as number) || String(a[1]).localeCompare(String(b[1])));
  assert.ok(expected.length > 10, `${expected.length} gains on day zero`);

  await asUser(world.userId, async (tx) => {
    const gains = await tx`
      select fact_no::int, captain_id, amount from infamy_gains where world_id = ${world.worldId}
      order by fact_no, captain_id`;
    assert.deepEqual(gains.map((g) => [g.fact_no, g.captain_id, g.amount]), expected);

    const captains = await tx`select id, infamy, power, legendary_fact from captains where world_id = ${world.worldId}`;
    for (const c of captains) {
      const s = state.captains[c.id]!;
      assert.deepEqual([c.infamy, c.power, c.legendary_fact], [s.infamy, s.power, s.legendaryFact], c.id);
    }
    const week = await tx`select captain_id, infamy from infamy_7d where world_id = ${world.worldId}`;
    const sums = new Map<string, number>();
    for (const [, id, amount] of expected) sums.set(id as string, (sums.get(id as string) ?? 0) + (amount as number));
    assert.deepEqual(Object.fromEntries(week.map((w) => [w.captain_id, w.infamy])), Object.fromEntries(sums));
  });

  const outsider = await newUser();
  await asUser(outsider, async (tx) => {
    assert.equal((await tx`select 1 from infamy_gains where world_id = ${world.worldId}`).length, 0);
    assert.equal((await tx`select 1 from infamy_7d where world_id = ${world.worldId}`).length, 0);
  });
  await assert.rejects(asUser(world.userId, (tx) => tx`delete from infamy_gains where world_id = ${world.worldId}`), /permission denied/);
});

test('a tick commits the throne changing hands: the fall, the crowning, the +20 and the new Warlord', async () => {
  const clock = fakeClock();
  const world = await freshWorld({ clock, seed: 909 });
  const [w] = await db()`select warlord_id from worlds where id = ${world.worldId}`;
  const warlord = w!.warlord_id as string;
  // Everyone active hates the Warlord, and he hates them back: he will be in a Clash soon enough.
  await db()`
    insert into affinity (world_id, holder_id, toward_id, value, updated_at)
    select ${world.worldId}, x.id, y.id, -100, now()
    from captains x, captains y
    where x.world_id = ${world.worldId} and y.world_id = x.world_id and x.roster = 'active' and y.roster = 'active'
      and x.id <> y.id and (x.id = ${warlord} or y.id = ${warlord})
    on conflict (world_id, holder_id, toward_id) do update set value = -100`;

  const { facts } = await tickUntil(world, clock, 'crowned');
  const crowned = facts[0]!.payload as { no: number; intro: { captainId: string }; previous: string; infamy: { captainId: string; amount: number }[] };
  assert.equal(crowned.previous, warlord);
  const king = crowned.intro.captainId;
  const [after] = await db()`select warlord_id from worlds where id = ${world.worldId}`;
  assert.equal(after!.warlord_id, king, 'the new Warlord is committed');
  const [fell] = await db()`
    select payload from facts where world_id = ${world.worldId} and kind = 'warlord_fell' order by no desc limit 1`;
  assert.equal((fell!.payload as { captainId: string }).captainId, warlord);
  const [gain] = await db()`
    select amount from infamy_gains where world_id = ${world.worldId} and fact_no = ${crowned.no} and captain_id = ${king}`;
  assert.equal(gain!.amount, 20, 'the throne is worth +20');
  const [row] = await db()`
    select c.infamy, (select coalesce(sum(amount), 0)::int from infamy_gains g where g.world_id = c.world_id and g.captain_id = c.id) as total
    from captains c where c.world_id = ${world.worldId} and c.id = ${king}`;
  assert.equal(row!.infamy, row!.total, 'lifetime Infamy is the sum of his gains');
});

test('an edition containing a Legendary deed leads with it, whatever its weight', async () => {
  const clock = fakeClock();
  const t0 = clock.iso();
  const world = await freshWorld({ clock, seed: 515 });
  // Everyone is one small mishap away from legend.
  await db()`update captains set infamy = 149 where world_id = ${world.worldId}`;
  const { facts } = await tickUntil(world, clock, 'legendary');
  const deed = (facts[0]!.payload as { deed: number }).deed;
  assert.equal(facts[0]!.story_no, deed, 'the legendary Fact belongs to the deed');
  const [legend] = await db()`
    select id from captains where world_id = ${world.worldId} and legendary_fact = ${deed}`;
  assert.ok(legend, 'his Legendary deed is recorded on him');

  // A much funnier story in the same window still comes second.
  clock.advance(1);
  const [heavy] = await insertStoryFacts(world.worldId, t0, [{ minute: Math.round((clock.now().getTime() - Date.parse(t0)) / 60_000), weight: 99 }]);
  clock.advance(1);
  const out = await openEdition({ sql: db(), now: clock.now }, { userId: world.userId, worldId: world.worldId });
  // Several Captains may have crossed 150 on the same tick: every deed ranks ahead of the heavy story.
  const deeds = (
    await db()`select distinct (payload->>'deed')::int as deed from facts where world_id = ${world.worldId} and kind = 'legendary'`
  ).map((r) => r.deed as number);
  const stories = out.edition.stories;
  assert.equal(stories[0]!.slot, 'lead');
  assert.ok(deeds.includes(deed));
  assert.ok(deeds.includes(stories[0]!.storyNo), 'a Legendary deed leads');
  assert.deepEqual(stories.slice(0, deeds.length).map((s) => s.storyNo).sort(), [...deeds].sort(), 'every Legendary deed comes first');
  assert.equal(stories[deeds.length]!.storyNo, heavy, 'then the heaviest story');
});
