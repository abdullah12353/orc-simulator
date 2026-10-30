// #39 Accusations (D20, D59): after a misfortune, one of the 6 accuser Captains may name a Player as the
// cause. Rare, often wrong, flavour only: an Accusation changes no state, and only a Player whose name
// has been rendered for that accuser can be named.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content } from '@orc/content';
import { simulate, type BlameEntry, type CaptainId, type Fact, type StateDiff, type WorldState } from '@orc/sim';
import { activeIds, addMinutes, freshWorld, SEEDS, step } from './support.ts';

type Accusation = Extract<Fact, { kind: 'accusation' }>;
const isAccusation = (f: Fact): f is Accusation => f.kind === 'accusation';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';
const ACCUSERS = content.cast.filter((c) => c.accuser).map((c) => c.id);

const render = (playerId: string, accuser: CaptainId) => ({
  accuser,
  clipKey: `names/${playerId}/${accuser}.mp3`,
  says: `Plaa-yer ${playerId.slice(0, 1)}`,
});

/**
 * A world where all 6 accusers are active and feeble, and every active Captain hates the next one, so
 * Clashes (and accusers losing them) come thick and fast.
 */
function brawl(seed: number, players: WorldState['players']): WorldState {
  const base = freshWorld({ seed, players: Object.keys(players) });
  const captains = { ...base.captains };
  for (const id of ACCUSERS) captains[id] = { ...captains[id]!, roster: 'active', power: 1 };
  const active = activeIds({ ...base, captains });
  const affinity: WorldState['affinity'] = {};
  active.forEach((id, i) => {
    affinity[`${id}>${active[(i + 1) % active.length]}`] = -95;
  });
  return { ...base, captains, affinity, players: { ...base.players, ...players } };
}

const player = (renderedFor: ReturnType<typeof render>[]) => ({ gold: 30, meddles: 3, firstMeddleDone: true, renderedFor });

test('an accuser only ever names a Player whose name was rendered for him', () => {
  const accusations: Accusation[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    let state = brawl(seed, {
      [P1]: player(ACCUSERS.map((a) => render(P1, a))),
      [P2]: player([render(P2, 'krug')]),
      [P3]: player([]),
    });
    for (let i = 0; i < 24; i++) {
      const r = step(state, seed);
      state = r.state;
      accusations.push(...r.facts.filter(isAccusation));
    }
  }
  assert.ok(accusations.length >= SEEDS, `${accusations.length} Accusations`);
  for (const a of accusations) {
    assert.ok(ACCUSERS.includes(a.accuser), `${a.accuser} is an accuser`);
    assert.notEqual(a.accused, P3, 'P3 has no render at all');
    if (a.accused === P2) assert.equal(a.accuser, 'krug', 'P2 is rendered only for Krúg');
    assert.equal(a.clipKey, `names/${a.accused}/${a.accuser}.mp3`, 'the clip is the render for this pair');
    assert.deepEqual(a.cast, [a.accuser]);
    assert.ok(a.line.includes(render(a.accused, a.accuser).says), `the line says the mangled name: ${a.line}`);
    assert.ok(a.storyNo < a.no, 'an Accusation belongs to the story of the misfortune');
  }
  assert.ok(accusations.some((a) => a.accused === P2), 'a Player rendered for one accuser can still be named');
});

test('a Player with no render is never accused, and nobody is when nobody is rendered', () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    let state = brawl(seed, { [P1]: player([]), [P2]: player([]) });
    for (let i = 0; i < 12; i++) {
      const r = step(state, seed);
      state = r.state;
      assert.deepEqual(r.facts.filter(isAccusation), [], `seed ${seed}`);
    }
  }
});

/** The diff with the Fact counter left out: an Accusation takes a Fact number, and nothing else. */
const withoutCounter = (d: StateDiff) => ({ ...d, world: { ...d.world, nextNo: undefined } });

test('Accusations change no state: the same tick with and without renders differs only by the Accusations', () => {
  let seen = 0;
  for (let seed = 1; seed <= SEEDS * 10; seed++) {
    const rendered = brawl(seed % 7, { [P1]: player(ACCUSERS.map((a) => render(P1, a))) });
    const unrendered = { ...rendered, players: { [P1]: player([]) } };
    const input = (s: WorldState): WorldState => ({ ...s, world: { ...s.world, tickSeq: 1, now: addMinutes(s.world.now, 5) } });
    const a = simulate(input(rendered), [], seed);
    const b = simulate(input(unrendered), [], seed);
    seen += a.facts.filter(isAccusation).length;
    assert.deepEqual(a.facts.filter((f) => !isAccusation(f)), b.facts, `seed ${seed}: the other Facts are untouched`);
    assert.deepEqual(withoutCounter(a.stateDiff), withoutCounter(b.stateDiff), `seed ${seed}: the diff is untouched`);
  }
  assert.ok(seen > 0, 'some Accusations were made');
});

test("across many seeds a meaningful share of Accusations are wrong, and they're right only when the Player is to blame", () => {
  // Every feud was started by a Meddle: P1's Rumour planted P1's Grudges. P2 meddled with nothing.
  const blame = (meddleId: string, playerId: string): BlameEntry => ({
    meddleId,
    playerId,
    verb: 'rumour',
    landedFact: 1,
    landedAt: '2026-10-30T11:00:00.000Z',
    hops: 0,
  });
  const cause = { fact: 1, blame: [blame('aaaaaaaa-0000-4000-8000-000000000001', P1)] };
  const accusations: { a: Accusation; blamed: Set<string> }[] = [];
  for (let seed = 1; seed <= Math.max(1000, SEEDS * 20); seed++) {
    const base = brawl(seed % 7, {
      [P1]: player(ACCUSERS.map((a) => render(P1, a))),
      [P2]: player(ACCUSERS.map((a) => render(P2, a))),
    });
    const grudgeTags = Object.keys(base.affinity).map((k, i) => {
      const [holder, toward] = k.split('>') as [CaptainId, CaptainId];
      return { no: 1000 + i, holder, toward, tag: 'owes him a pie', at: base.world.now, cause };
    });
    const state: WorldState = { ...base, grudgeTags, world: { ...base.world, tickSeq: 1, now: addMinutes(base.world.now, 5) } };
    const { facts } = simulate(state, [], seed);
    const byNo = new Map(facts.map((f) => [f.no, f]));
    for (const a of facts.filter(isAccusation)) {
      const head = byNo.get(a.storyNo)!;
      assert.deepEqual(a.blame, head.blame.map((b) => ({ ...b, hops: b.hops + 1 })), 'the misfortune’s Blame, one hop on');
      accusations.push({ a, blamed: new Set(head.blame.map((b) => b.playerId)) });
    }
  }
  assert.ok(accusations.length >= 40, `${accusations.length} Accusations`);
  for (const { a, blamed } of accusations) assert.equal(a.correct, blamed.has(a.accused), `Accusation ${a.no}`);
  const wrong = accusations.filter(({ a }) => !a.correct).length / accusations.length;
  assert.ok(wrong >= 0.2 && wrong <= 0.8, `${Math.round(wrong * 100)}% wrong`);
});

test("an Accusation is a consequence of a lost Clash, made by the loser, and weighs nothing of its own", () => {
  let checked = 0;
  for (let seed = 1; seed <= SEEDS * 5 && checked < 5; seed++) {
    const state = brawl(seed % 7, { [P1]: player(ACCUSERS.map((a) => render(P1, a))) });
    const { facts } = simulate({ ...state, world: { ...state.world, tickSeq: 1, now: addMinutes(state.world.now, 5) } }, [], seed);
    for (const a of facts.filter(isAccusation)) {
      const head = facts.find((f) => f.no === a.storyNo)!;
      assert.equal(head.kind, 'clash');
      if (head.kind === 'clash') assert.equal(head.loser, a.accuser, 'the loser does the accusing');
      assert.deepEqual(a.causes, [head.no]);
      assert.equal(a.tier, 'templated');
      assert.equal(a.comedyWeight, undefined, 'a consequence carries no comedy weight');
      checked++;
    }
  }
  assert.ok(checked > 0);
});
