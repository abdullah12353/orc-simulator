// #40 The Hall of Shame (data-model §4.2, §4.3, §4.5): rap sheets, the shelves, Captain stories, the
// timeline, Clash replays and "trace it back". The Hall keeps the best idiocy in time order, never ranked.
// Stories here are hand-made Facts written through `insertFacts`, so their causes and Blame are real rows.
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content } from '@orc/content';
import { insertFacts } from '@orc/server';
import { BLAME, chain, type Cause, type Fact } from '@orc/sim';
import { asUser, asUserCommitted, db, fakeClock, freshWorld, newUser } from './support.ts';

type World = Awaited<ReturnType<typeof freshWorld>>;

const MINUTE = 60_000;
const at = (from: string, minute: number) => new Date(Date.parse(from) + minute * MINUTE).toISOString();

async function joinAs(world: World, displayName: string) {
  const [inv] = await asUserCommitted(world.userId, (tx) => tx`select token from create_invite(${world.worldId})`);
  const userId = await newUser();
  const [row] = await asUserCommitted(userId, (tx) => tx`select join_world(${inv!.token}, ${displayName}) as id`);
  return { userId, playerId: row!.id as string };
}

interface Spec {
  minute: number;
  kind?: string;
  line?: string;
  weight?: number;
  tier?: Fact['tier'];
  cast?: string[];
  /** Facts whose state this one required (its causes, carrying their Blame one hop on). */
  requires?: Fact[];
  /** The story head this is a consequence of; omit for a head. */
  storyOf?: Fact;
  /** A Player whose Meddle lands as this Fact (Blame hop 0); makes the intent and meddle rows. */
  meddleBy?: string;
  payload?: Record<string, unknown>;
}

/** Appends hand-made Facts, numbered from the world's `next_no`, with their causes and Blame. */
async function write(world: World, from: string, specs: Spec[]): Promise<Fact[]> {
  const sql = db();
  const out: Fact[] = [];
  for (const s of specs) {
    const [w] = await sql<{ next_no: number; tick_seq: number }[]>`
      select next_no::int, tick_seq::int from worlds where id = ${world.worldId}`;
    const no = w!.next_no;
    const when = at(from, s.minute);
    const own = [];
    if (s.meddleBy) {
      const id = randomUUID();
      await sql`insert into intents (id, world_id, player_id, kind, payload, status)
                values (${id}, ${world.worldId}, ${s.meddleBy}, 'rumour', '{}', 'consumed')`;
      await sql`insert into meddles (id, world_id, player_id, verb, target_id, created_at, status, landed_fact)
                values (${id}, ${world.worldId}, ${s.meddleBy}, 'rumour', 'krug', ${when}, 'landed', ${no})`;
      own.push({ meddleId: id, playerId: s.meddleBy, verb: 'rumour' as const, landedFact: no, landedAt: when, hops: 0 });
    }
    const requires: Cause[] = (s.requires ?? []).map((f) => ({ fact: f.no, blame: f.blame }));
    const head = s.storyOf === undefined;
    const { causes, blame } = chain({ requires, own });
    const fact = {
      no,
      at: when,
      storyNo: head ? no : s.storyOf!.no,
      line: s.line ?? `Fact ${no}.`,
      tier: s.tier ?? (head ? 'templated' : 'silent'),
      cast: s.cast ?? [],
      causes,
      blame,
      infamy: [],
      kind: s.kind ?? 'incident',
      ...(head ? { comedyWeight: s.weight ?? 4 } : {}),
      ...s.payload,
    } as unknown as Fact;
    await sql.begin(async (tx) => {
      await insertFacts(tx, world.worldId, [{ tickSeq: w!.tick_seq, fact }], content);
      await tx`update worlds set next_no = ${no + 1} where id = ${world.worldId}`;
    });
    out.push(fact);
  }
  return out;
}

/** Prints a story in some Player's edition with this headline (what the rap sheet's caption prefers). */
async function printHeadline(world: World, playerId: string, storyNo: number, headline: string, createdAt: string, slot = 'lead') {
  const sql = db();
  const [{ n }] = await sql`select coalesce(max(no), 0)::int + 1 as n from editions where player_id = ${playerId}`;
  const [ed] = await sql`
    insert into editions (world_id, player_id, no, covers_from, covers_to, created_at, masthead)
    values (${world.worldId}, ${playerId}, ${n}, ${createdAt}, ${createdAt}, ${createdAt}, '{}') returning id`;
  const rank = slot === 'lead' ? 1 : slot === 'headline' ? 2 : 9;
  await sql`insert into edition_stories (edition_id, rank, story_no, slot, headline)
            values (${ed!.id}, ${rank}, ${storyNo}, ${slot}, ${headline})`;
}

const rapSheet = (userId: string, playerId: string) =>
  asUser(userId, (tx) => tx<{ fact_no: number; at: Date; comedy_weight: number; caption: string; hops: number }[]>`
    select fact_no::int, at, comedy_weight, caption, hops from rap_sheet(${playerId})`);

test('a rap sheet holds the 10 heaviest stories a Player is blamed for, shown by time, captioned by the latest headline', async () => {
  const clock = fakeClock();
  const world = await freshWorld({ clock }); // Mo
  const dazza = await joinAs(world, 'Dazza');
  const t0 = clock.iso();

  // Mo's Rumour lands (weight 3: too light for the sheet), then 12 stories carry its Blame on, with
  // weights that don't follow time, so a sheet sorted by weight would read differently.
  const [rumour] = await write(world, t0, [{ minute: 0, weight: 3, meddleBy: world.playerId, line: 'Mo starts it.' }]);
  const weights = [40, 12, 55, 8, 30, 70, 9, 21, 64, 15, 48, 33];
  const stories = await write(
    world,
    t0,
    weights.map((weight, i) => ({ minute: 10 + i * 10, weight, requires: [rumour!], line: `Story weighing ${weight}.` })),
  );
  // A silent consequence carries Mo's Blame too, but only heads go on a sheet.
  await write(world, t0, [{ minute: 200, requires: [stories[0]!], storyOf: stories[0]!, kind: 'grudge', line: '' }]);
  // Dazza's own story is not on Mo's sheet.
  await write(world, t0, [{ minute: 210, weight: 99, meddleBy: dazza.playerId, line: "Dazza's mess." }]);

  // Two Players printed the 70 story; the later edition's headline is the caption.
  const seventy = stories[weights.indexOf(70)]!;
  await printHeadline(world, world.playerId, seventy.no, 'An early headline', at(t0, 300));
  await printHeadline(world, dazza.playerId, seventy.no, 'KRÚG IN MOAT SHOCK', at(t0, 400));

  // Anyone in the world can read Mo's sheet.
  const sheet = await rapSheet(dazza.userId, world.playerId);
  const heaviest = [70, 64, 55, 48, 40, 33, 30, 21, 15, 12];
  const expected = stories.filter((s) => heaviest.includes(s.comedyWeight!)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  assert.deepEqual(sheet.map((r) => r.fact_no), expected.map((s) => s.no), 'the 10 heaviest, newest first');
  assert.deepEqual(sheet.map((r) => r.at.toISOString()), expected.map((s) => s.at));
  assert.equal(sheet.find((r) => r.fact_no === seventy.no)!.caption, 'KRÚG IN MOAT SHOCK');
  assert.equal(sheet.find((r) => r.comedy_weight === 40)!.caption, 'Story weighing 40.', 'never printed: its line');
  assert.ok(sheet.every((r) => r.hops === 1));
});
