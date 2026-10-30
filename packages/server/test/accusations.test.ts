// #39 Accusations on the backend: the operator registers name renders, the tick loads them so accusers
// name only rendered Players (stepping exactly like the sim in memory), and the Herald prints at most one
// Accusation per edition, above the story's true Blame line, only if its render exists.
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content } from '@orc/content';
import { applyDiff, dayZero, simulate, STARTING, stateHash, tickSeed, type Fact, type NameRender, type WorldState } from '@orc/sim';
import { NameRenderError, openEdition, registerNameRender, tickWorld } from '@orc/server';
import { asUser, asUserCommitted, db, fakeClock, freshWorld, insertStoryFacts, newUser } from './support.ts';

type Clock = ReturnType<typeof fakeClock>;
type World = Awaited<ReturnType<typeof freshWorld>>;
type Accusation = Extract<Fact, { kind: 'accusation' }>;
const isAccusation = (f: Fact): f is Accusation => f.kind === 'accusation';

const ACCUSERS = content.cast.filter((c) => c.accuser).map((c) => c.id).sort();

async function joinAs(world: World, displayName: string) {
  const [inv] = await asUserCommitted(world.userId, (tx) => tx`select token from create_invite(${world.worldId})`);
  const userId = await newUser();
  const [row] = await asUserCommitted(userId, (tx) => tx`select join_world(${inv!.token}, ${displayName}) as id`);
  return { userId, playerId: row!.id as string };
}

const clipKey = (playerId: string, accuser: string) => `names/${playerId}/${accuser}.mp3`;

async function renderFor(playerId: string, accuser: string, says: string): Promise<NameRender> {
  await registerNameRender({ sql: db() }, { playerId, accuserId: accuser, clipKey: clipKey(playerId, accuser), says });
  return { accuser, clipKey: clipKey(playerId, accuser), says };
}

test('the operator registers a name render per accuser; its mangled name joins the Player’s; members can read it', async () => {
  const clock = fakeClock();
  const world = await freshWorld({ clock });
  await renderFor(world.playerId, 'krug', 'Mohhh');
  await renderFor(world.playerId, ACCUSERS.find((a) => a !== 'krug')!, 'Mo-Mo');
  // Re-rendering replaces the clip; a name already on the list isn't added twice.
  await registerNameRender({ sql: db() }, { playerId: world.playerId, accuserId: 'krug', clipKey: 'names/v2.mp3', says: 'Mohhh' });

  const [p] = await db()`select mangled_names from players where id = ${world.playerId}`;
  assert.deepEqual(p!.mangled_names, ['Mohhh', 'Mo-Mo']);
  const rows = await asUser(world.userId, (tx) => tx`
    select accuser_id, clip_key, says from name_renders where player_id = ${world.playerId} order by accuser_id`);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.find((r) => r.accuser_id === 'krug'), { accuser_id: 'krug', clip_key: 'names/v2.mp3', says: 'Mohhh' });

  const outsider = await newUser();
  assert.equal((await asUser(outsider, (tx) => tx`select 1 from name_renders where player_id = ${world.playerId}`)).length, 0);
  await assert.rejects(
    asUser(world.userId, (tx) => tx`insert into name_renders (player_id, accuser_id, clip_key, says) values (${world.playerId}, 'krug', 'x', 'y')`),
    /permission denied/,
  );

  const notAnAccuser = content.cast.find((c) => !c.accuser)!.id;
  await assert.rejects(
    registerNameRender({ sql: db() }, { playerId: world.playerId, accuserId: notAnAccuser, clipKey: 'k', says: 'Mo' }),
    (e) => e instanceof NameRenderError && e.message === 'not_an_accuser',
  );
  await assert.rejects(
    registerNameRender({ sql: db() }, { playerId: randomUUID(), accuserId: 'krug', clipKey: 'k', says: 'Mo' }),
    (e) => e instanceof NameRenderError && e.message === 'no_such_player',
  );
});

test('ticks make Accusations naming only rendered Players, and step exactly like the sim in memory', async () => {
  const clock = fakeClock();
  const createdAt = clock.iso();
  const seed = 3939;
  const world = await freshWorld({ clock, seed });
  const dazza = await joinAs(world, 'Dazza');
  const kev = await joinAs(world, 'Kev'); // never rendered
  const mo = await Promise.all(ACCUSERS.map((a) => renderFor(world.playerId, a, 'Mohhh')));
  const dz = [await renderFor(dazza.playerId, 'krug', 'Dazzler')];

  let { state } = dayZero(content, seed, createdAt, world.worldId);
  const fresh = (renderedFor: NameRender[]) => ({ gold: STARTING.gold, meddles: STARTING.meddles, firstMeddleDone: false, renderedFor });
  state = { ...state, players: { [world.playerId]: fresh(mo), [dazza.playerId]: fresh(dz), [kev.playerId]: fresh([]) } };

  // Every accuser is active and feeble, and every active Captain hates the next one: accusers lose Clashes.
  await db()`update captains set roster = 'active', power = 1 where world_id = ${world.worldId} and id = any(${ACCUSERS})`;
  const captains = { ...state.captains };
  for (const id of ACCUSERS) captains[id] = { ...captains[id]!, roster: 'active', power: 1 };
  const active = Object.keys(captains).filter((id) => captains[id]!.roster === 'active').sort();
  const feuds = active.map((id, i) => ({ holder: id, toward: active[(i + 1) % active.length]!, value: -95 }));
  await db()`
    insert into affinity (world_id, holder_id, toward_id, value, updated_at)
    select ${world.worldId}, a->>'holder', a->>'toward', (a->>'value')::smallint, ${createdAt}
    from jsonb_array_elements(${db().json(feuds)}) as a
    on conflict (world_id, holder_id, toward_id) do update set value = excluded.value`;
  state = { ...state, captains, affinity: { ...state.affinity, ...Object.fromEntries(feuds.map((f) => [`${f.holder}>${f.toward}`, f.value])) } };

  const accusations: Accusation[] = [];
  for (let i = 0; i < 24; i++) {
    clock.advance(5);
    const tickSeq = state.world.tickSeq + 1;
    const input: WorldState = { ...state, world: { ...state.world, tickSeq, prevTickAt: state.world.now, now: clock.iso() } };
    const { facts, stateDiff } = simulate(input, [], tickSeed(seed, tickSeq));
    state = applyDiff(input, stateDiff);
    accusations.push(...facts.filter(isAccusation));

    const out = await tickWorld({ sql: db(), now: clock.now }, world.worldId);
    assert.equal(out.status, 'stepped');
    if (out.status !== 'stepped') return;
    assert.equal(out.factCount, facts.length, `tick ${tickSeq}`);
    assert.equal(out.stateHash, stateHash(state), `tick ${tickSeq}: the tick loaded the same renders`);
  }

  assert.ok(accusations.length > 0, 'some Accusations were made');
  const rows = await asUser(dazza.userId, (tx) => tx`
    select no::int, payload from facts where world_id = ${world.worldId} and kind = 'accusation' order by no`);
  assert.deepEqual(rows.map((r) => r.no), accusations.map((a) => a.no), 'committed, and members can read them');
  for (const { payload } of rows) {
    assert.notEqual(payload.accused, kev.playerId, 'Kev has no render');
    if (payload.accused === dazza.playerId) assert.equal(payload.accuser, 'krug');
    assert.equal(payload.clipKey, clipKey(payload.accused, payload.accuser));
  }
});

/** Plants a Rumour as `userId` and ticks until it lands. Returns its landing Fact. */
async function landRumour(world: World, clock: Clock, userId: string): Promise<Fact> {
  const rows = await db()<{ id: string; traits: string[] }[]>`
    select id, traits from captains where world_id = ${world.worldId} and roster = 'active' order by id`;
  const id = randomUUID();
  const payload = { source: rows[0]!.id, target: rows[1]!.id, claim: 'insult', subject: { from: 'trait', key: rows[1]!.traits[0] } };
  await asUserCommitted(userId, (tx) => tx`select * from submit_intent(${id}, ${world.worldId}, 'rumour', ${tx.json(payload)})`);
  for (const minutes of [5, 95]) {
    clock.advance(minutes);
    assert.equal((await tickWorld({ sql: db(), now: clock.now }, world.worldId)).status, 'stepped');
  }
  const [m] = await db()`select landed_fact::int from meddles where id = ${id}`;
  assert.ok(m?.landed_fact, 'the Rumour landed');
  const [f] = await db()`select payload from facts where world_id = ${world.worldId} and no = ${m.landed_fact}`;
  return f!.payload as Fact;
}

/** A hand-made Accusation on the head numbered `storyNo`. */
const accusation = (storyNo: number, accuser: string, accused: string, line: string) => ({
  minute: 0,
  kind: 'accusation',
  storyNo,
  line,
  payload: { accuser, accused, correct: false, clipKey: clipKey(accused, accuser) },
});

test('an edition shows at most one Accusation, the heaviest rendered one, above its story’s true Blame line', async () => {
  const clock = fakeClock();
  const world = await freshWorld({ clock }); // the creator is "Mo"
  const dazza = await joinAs(world, 'Dazza');
  const kev = await joinAs(world, 'Kev');
  await openEdition({ sql: db(), now: clock.now }, world); // edition #1: day zero

  // Mo's Rumour is the true cause of its story. (Renders come after, so the ticks accuse nobody.)
  const rumour = await landRumour(world, clock, world.userId);
  await renderFor(dazza.playerId, 'krug', 'Dazzler');
  await renderFor(kev.playerId, 'krug', 'Kevvo'); // rendered for Krúg only
  const other = ACCUSERS.find((a) => a !== 'krug')!;
  clock.advance(1);
  const from = clock.iso();
  const [heaviest, heavy, light] = await insertStoryFacts(world.worldId, from, [
    { minute: 0, weight: 99, line: 'The heaviest story.' },
    { minute: 0, weight: 98, line: 'A heavy story.' },
    { minute: 0, weight: 0, line: 'A light story.' },
  ]);
  const [onRumour, onLight] = await insertStoryFacts(world.worldId, from, [
    accusation(rumour.no, 'krug', dazza.playerId, 'Krúg: "It was Dazzler."'), // wrong: Mo did it
    accusation(light!, 'krug', kev.playerId, 'Krúg: "Kevvo!"'),
    accusation(heaviest!, other, kev.playerId, 'Nobody rendered: "Kevvo!"'), // Kev has no render for him
    accusation(heavy!, 'krug', randomUUID(), 'Krúg: "Who?"'), // not a Player with a render at all
  ]);

  clock.advance(1);
  const out = await openEdition({ sql: db(), now: clock.now }, world);
  assert.equal(out.created, true);
  const ed = out.edition;
  const printed = new Set(ed.stories.map((s) => s.storyNo));
  for (const no of [rumour.no, heaviest!, heavy!, light!]) assert.ok(printed.has(no), `story ${no} is in the edition`);

  // The two heaviest stories' Accusations have no render behind them, so the Rumour's story (heavier
  // than the light one) carries the only Accusation printed.
  assert.deepEqual(ed.accusation, {
    factNo: onRumour!,
    storyNo: rumour.no,
    accuser: 'krug',
    line: 'Krúg: "It was Dazzler."',
    clipKey: clipKey(dazza.playerId, 'krug'),
  });
  assert.notEqual(ed.accusation?.factNo, onLight, 'at most one Accusation per edition');
  const [row] = await db()`select accusation_fact::int from editions where id = ${ed.id}`;
  assert.equal(row!.accusation_fact, onRumour!);
  // It sits over the story's true Blame line, which still names Mo, not the accused.
  const story = ed.stories.find((s) => s.storyNo === rumour.no)!;
  assert.equal(story.blameLine, 'It all began when Mo planted a Rumour.');

  // Reopening (no new edition due) gives the same Accusation back.
  const again = await openEdition({ sql: db(), now: clock.now }, world);
  assert.equal(again.created, false);
  assert.deepEqual(again.edition.accusation, ed.accusation);
});

test('a Player without a render is never shown as Accused', async () => {
  const clock = fakeClock();
  const world = await freshWorld({ clock });
  const kev = await joinAs(world, 'Kev'); // no render at all
  await openEdition({ sql: db(), now: clock.now }, world);
  clock.advance(1);
  const [head] = await insertStoryFacts(world.worldId, clock.iso(), [{ minute: 0, weight: 50, line: 'A story.' }]);
  await insertStoryFacts(world.worldId, clock.iso(), [accusation(head!, 'krug', kev.playerId, 'Krúg: "Kevvo!"')]);
  clock.advance(31);
  const out = await openEdition({ sql: db(), now: clock.now }, world);
  assert.equal(out.created, true);
  assert.ok(out.edition.stories.some((s) => s.storyNo === head));
  assert.equal(out.edition.accusation, null);
});
