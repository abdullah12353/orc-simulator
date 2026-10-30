// #30 Grudge Clashes (D48): Grudges below −50 boil over into Clashes, decided by Power, Traits and luck.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content } from '@orc/content';
import { applyDiff, clashShape, fallbackDialogue, shapeProblem, simulate, type CaptainId, type Fact, type WorldState } from '@orc/sim';
import { activeIds, addMinutes, freshWorld, SEEDS } from './support.ts';

type ClashFact = Extract<Fact, { kind: 'clash' }>;
const isClash = (f: Fact): f is ClashFact => f.kind === 'clash';

/** Two active Captains with no Trait that bends Clash odds or chances. */
function plainPair(state: WorldState, power?: [number, number]): [CaptainId, CaptainId] {
  const bends = ['Hothead', 'Coward', 'Drunkard', 'Lazy', 'Show-off'];
  const plain = activeIds(state, (id) => !state.captains[id]!.traits.some((t) => bends.includes(t)));
  if (!power) return [plain[0]!, plain[1]!];
  const a = plain.find((id) => state.captains[id]!.power === power[0]);
  const b = plain.find((id) => id !== a && state.captains[id]!.power === power[1]);
  return [a!, b!];
}

/** A world where the only feeling anyone has is `holder`'s towards `toward`, at `value`. */
function feud(value: number, opts: { seed?: number; pair?: [CaptainId, CaptainId]; reverse?: number } = {}) {
  const base = freshWorld({ seed: opts.seed ?? 1 });
  const [holder, toward] = opts.pair ?? plainPair(base);
  const affinity: WorldState['affinity'] = { [`${holder}>${toward}`]: value };
  if (opts.reverse !== undefined) affinity[`${toward}>${holder}`] = opts.reverse;
  const state: WorldState = {
    ...base,
    affinity,
    grudgeTags: [],
    world: { ...base.world, tickSeq: 1, now: addMinutes(base.world.now, 5) },
  };
  return { state, holder: holder!, toward: toward! };
}

/** The Clashes one tick produces under each of `n` tick seeds. */
function clashesOver(state: WorldState, n: number): ClashFact[] {
  const out: ClashFact[] = [];
  for (let seed = 1; seed <= n; seed++) out.push(...simulate(state, [], seed).facts.filter(isClash));
  return out;
}

test('a pair at −51 in only one direction can Clash, about 5% of ticks; a pair at −50 never does', () => {
  const n = Math.max(2000, SEEDS * 100);
  const hot = feud(-51);
  const clashes = clashesOver(hot.state, n);
  const rate = clashes.length / n;
  assert.ok(Math.abs(rate - 0.05) < 0.015, `rate ${rate}`);
  for (const c of clashes) {
    assert.equal(c.trigger, 'grudge');
    assert.deepEqual([c.a, c.b], [hot.holder, hot.toward], 'the one holding the Grudge starts it');
  }

  assert.equal(clashesOver(feud(-50).state, n).length, 0, '−50 is not below −50');
  assert.equal(clashesOver(feud(-51, { pair: [hot.toward, hot.holder] }).state, n).length > 0, true, 'either direction will do');
});

/**
 * Four disjoint feuding pairs, every holder at Power `pa` and every target at `pb`, all with the same two
 * Traits that bend nothing (`traits`, unless given), so many Clashes of one shape come out of each tick.
 */
function arena(pa: number, pb: number, traits: [string, string] = ['Snob', 'Hoarder']) {
  const base = freshWorld({ seed: 5 });
  const ids = activeIds(base).filter((id) => id !== base.world.warlordId).slice(0, 8);
  const captains = { ...base.captains };
  const affinity: WorldState['affinity'] = {};
  for (let i = 0; i < 8; i += 2) {
    captains[ids[i]!] = { ...captains[ids[i]!]!, power: pa, traits };
    captains[ids[i + 1]!] = { ...captains[ids[i + 1]!]!, power: pb, traits: ['Snob', 'Hoarder'] };
    affinity[`${ids[i]}>${ids[i + 1]}`] = -80;
  }
  const state: WorldState = { ...base, captains, affinity, grudgeTags: [], world: { ...base.world, tickSeq: 1 } };
  return { state, holders: new Set(ids.filter((_, i) => i % 2 === 0)) };
}

/** Every Clash (with the rest of its story) over `n` tick seeds. */
function storiesOver(state: WorldState, n: number): { head: ClashFact; story: Fact[] }[] {
  const out: { head: ClashFact; story: Fact[] }[] = [];
  for (let seed = 1; seed <= n; seed++) {
    const { facts } = simulate(state, [], seed);
    for (const head of facts.filter(isClash)) out.push({ head, story: facts.filter((f) => f.storyNo === head.no) });
  }
  return out;
}

const N = Math.max(10_000, SEEDS * 100);

test('win rates follow the logistic Power odds: a Power 3 beats a Power 7 about 1 time in 5', () => {
  for (const [pa, pb, expected] of [
    [3, 7, 0.2],
    [7, 3, 0.8],
    [5, 5, 0.5],
  ] as const) {
    const { state, holders } = arena(pa, pb);
    const clashes = storiesOver(state, N).map((s) => s.head);
    assert.ok(clashes.length > 1000, `${clashes.length} Clashes`);
    for (const c of clashes) {
      assert.ok(holders.has(c.a), 'the holder starts it');
      assert.equal(c.pA, expected, `Power ${pa} v ${pb}`);
      assert.deepEqual([c.edgeA, c.edgeB], [0, 0], 'no Backing yet');
      assert.notEqual(c.outcome, 'fled', 'nobody here is a Coward');
      assert.equal(c.winner, c.outcome === 'won' ? c.a : c.b);
    }
    const rate = clashes.filter((c) => c.outcome === 'won').length / clashes.length;
    assert.ok(Math.abs(rate - expected) < 0.035, `Power ${pa} v ${pb}: a won ${rate}`);
  }
});

test('a Hothead fights a little better, a Drunkard a little worse', () => {
  const pA = (traits: [string, string]) => storiesOver(arena(5, 5, traits).state, 400)[0]!.head.pA;
  assert.equal(pA(['Hothead', 'Snob']), 0.55);
  assert.equal(pA(['Drunkard', 'Snob']), 0.45);
});

test('a wrong saviour crashes in about 1 Clash in 5, drawn in by a magnet, and never one of the pair', () => {
  const stories = storiesOver(arena(5, 5).state, N);
  const saved = stories.filter((s) => s.head.saviour);
  const rate = saved.length / stories.length;
  assert.ok(Math.abs(rate - 0.2) < 0.03, `saviour rate ${rate}`);
  const magnets = new Set([...Object.values(content.banks.clash.magnets), content.banks.clash.anyMagnet]);
  for (const { head } of saved) {
    assert.ok(![head.a, head.b].includes(head.saviour!));
    assert.ok(head.cast.includes(head.saviour!));
    assert.ok(magnets.has(head.saviourMagnet!), head.saviourMagnet);
  }
});

test('the winner takes a Trophy in about half of defeats, and it changes hands', () => {
  const stories = storiesOver(arena(5, 5).state, N);
  const trophies = stories.map((s) => s.story.find((f) => f.kind === 'trophy'));
  const rate = trophies.filter(Boolean).length / stories.length;
  assert.ok(Math.abs(rate - 0.5) < 0.03, `Trophy rate ${rate}`);
  for (const [i, t] of trophies.entries()) {
    if (!t || t.kind !== 'trophy') continue;
    const head = stories[i]!.head;
    assert.deepEqual([t.from, t.to, t.storyNo], [head.loser, head.winner, head.no]);
    assert.ok(content.banks.trophies[t.key], t.key);
  }
});

test('a Coward who is losing usually runs: fled, and no Trophy', () => {
  const stories = storiesOver(arena(3, 7, ['Coward', 'Snob']).state, N / 2);
  const lost = stories.filter((s) => s.head.loser === s.head.a);
  const fled = lost.filter((s) => s.head.outcome === 'fled');
  assert.ok(Math.abs(fled.length / lost.length - 0.6) < 0.05, `${fled.length} of ${lost.length} fled`);
  for (const s of fled) assert.ok(!s.story.some((f) => f.kind === 'trophy'), 'no Trophy from a runner');
});

test('every Clash has a fallback key, and its fallback script has 3 lines (4 with a saviour) with the loser last', () => {
  const stories = [
    ...storiesOver(arena(5, 5).state, 4000),
    ...storiesOver(arena(3, 7, ['Coward', 'Snob']).state, 4000),
  ];
  const keys = new Set<string>();
  for (const { head } of stories) {
    const script = content.banks.clash.scripts[head.fallbackKey];
    assert.ok(script, `fallback key ${head.fallbackKey} is in the bank`);
    assert.ok(script.outcomes.includes(head.outcome) && script.saviour === Boolean(head.saviour), head.fallbackKey);
    keys.add(head.fallbackKey);

    const lines = fallbackDialogue(content, head);
    assert.deepEqual(clashShape(head), {
      lines: head.saviour ? 4 : 3,
      speakers: head.saviour ? [head.a, head.b, head.saviour] : [head.a, head.b],
      loser: head.loser,
    });
    assert.equal(lines.length, head.saviour ? 4 : 3);
    assert.equal(lines.at(-1)!.speaker, head.loser, 'the loser speaks last');
    assert.equal(lines.some((l) => l.speaker === head.saviour), Boolean(head.saviour), 'the saviour speaks iff he came');
    for (const l of lines) {
      assert.ok([head.a, head.b, head.saviour].includes(l.speaker));
      assert.doesNotMatch(l.text, /[{}]/, l.text);
    }
  }
  assert.ok(keys.size >= 6, `${keys.size} different scripts in use`);
});

test('the Clash shape rejects a short script, a stranger speaking, and the winner having the last word', () => {
  const head = storiesOver(arena(5, 5).state, 400).find((s) => !s.head.saviour)!.head;
  const lines = fallbackDialogue(content, head);
  assert.equal(shapeProblem(head, lines), null);
  assert.match(shapeProblem(head, lines.slice(1))!, /3 lines/);
  assert.match(shapeProblem(head, [{ speaker: 'nobody', text: 'Oi.' }, ...lines.slice(1)])!, /speaker/);
  assert.match(shapeProblem(head, [...lines.slice(0, 2), { speaker: head.winner, text: 'I win.' }])!, /loser/);
});

test('a Clash vents the Grudge, and the loser holds a new one against the winner', () => {
  const { state } = feud(-60);
  for (let seed = 1; seed <= 400; seed++) {
    const { facts, stateDiff } = simulate(state, [], seed);
    const head = facts.find(isClash);
    if (!head) continue;
    const next = applyDiff(state, stateDiff);
    const grudge = facts.find((f) => f.kind === 'grudge' && f.holder === head.loser && f.toward === head.winner);
    assert.ok(grudge, 'the loser holds a Grudge');
    assert.ok(next.grudgeTags.some((t) => t.holder === head.loser && t.toward === head.winner && t.cause?.fact === head.no));
    // −60 + 25 = −35 for a winning holder; −35 − 15 = −50 for a losing one: either way, no longer below −50.
    assert.ok(next.affinity[`${head.a}>${head.b}`]! >= -50, `${next.affinity[`${head.a}>${head.b}`]}`);
  }
});
