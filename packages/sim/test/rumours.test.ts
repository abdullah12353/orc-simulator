import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content } from '@orc/content';
import { applyDiff, simulate, type Claim, type WorldState } from '@orc/sim';
import { activeIds, addMinutes, dare, freshWorld, rumour, SEEDS, step } from './support.ts';

const P1 = '11111111-1111-4111-8111-111111111111';
const minutesBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 60_000;

/** A world with one Player, and a source and target who are active and unremarkable. */
function setup(seed = 1): { state: WorldState; source: string; target: string } {
  const state = freshWorld({ seed, players: [P1] });
  const [source, target] = activeIds(state);
  return { state, source: source!, target: target! };
}

test('a Rumour intent becomes a pending Meddle on a 10–90 minute Fuse, and nothing is said about it', () => {
  const fuseMinutes = new Set<number>();
  for (let seed = 1; seed <= Math.max(200, SEEDS * 10); seed++) {
    const { state, source, target } = setup(seed);
    const intent = rumour(state, P1, { source, target });
    const r = step(state, seed, 5, [intent]);

    assert.deepEqual(r.diff.intents, [{ id: intent.id, status: 'consumed' }]);
    assert.equal(r.diff.newMeddles.length, 1);
    const m = r.diff.newMeddles[0]!;
    assert.equal(m.id, intent.id);
    assert.equal(m.playerId, P1);
    assert.equal(m.status, 'pending');
    assert.equal(m.intent.kind, 'rumour');
    assert.equal(r.diff.fuses.add.length, 1);
    const fuse = r.diff.fuses.add[0]!;
    assert.equal(fuse.meddleId, intent.id);
    const minutes = minutesBetween(r.state.world.now, fuse.dueAt);
    assert.ok(Number.isInteger(minutes) && minutes >= 10 && minutes <= 90, `fuse of ${minutes} min`);
    fuseMinutes.add(minutes);

    assert.equal(r.state.meddles[intent.id]?.status, 'pending');
    assert.equal(r.state.players[P1]!.meddles, 3, 'already debited at submit: the tick charges nothing');
    for (const f of r.facts) assert.ok(!JSON.stringify(f).includes(intent.id), 'no Fact carries a pending Meddle');
  }
  assert.ok(Math.min(...fuseMinutes) <= 15 && Math.max(...fuseMinutes) >= 85, 'fuses spread over 10–90');
});

test("a Player's guided first Rumour gets a 2–5 minute Fuse, and a later one 10–90", () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { state, source, target } = setup(seed);
    const first = step(state, seed, 5, [rumour(state, P1, { source, target, firstMeddle: true })]);
    const due = minutesBetween(first.state.world.now, first.diff.fuses.add[0]!.dueAt);
    assert.ok(due >= 2 && due <= 5, `first fuse ${due} min`);
    assert.equal(first.state.players[P1]!.firstMeddleDone, true);

    const again = step(first.state, seed, 5, [rumour(first.state, P1, { source, target, firstMeddle: true })]);
    const later = minutesBetween(again.state.world.now, again.diff.fuses.add[0]!.dueAt);
    assert.ok(later >= 10 && later <= 90, `a second "first" Rumour still waits 10–90, got ${later}`);
  }
});

test('a first Meddle the sim rejects still uses up the short Fuse (submit_intent marked it done)', () => {
  const { state, source, target } = setup(3);
  const bad = step(state, 3, 5, [rumour(state, P1, { source, target: source, firstMeddle: true })]);
  assert.equal(bad.diff.intents[0]!.status, 'rejected');
  assert.equal(bad.state.players[P1]!.firstMeddleDone, true, 'the DB set first_meddle_done when it was submitted');

  const next = step(bad.state, 3, 5, [rumour(bad.state, P1, { source, target, firstMeddle: true })]);
  const due = minutesBetween(next.state.world.now, next.diff.fuses.add[0]!.dueAt);
  assert.ok(due >= 10 && due <= 90, `the next Meddle waits 10–90, got ${due}`);
});

test('a first Dare gets the 2–5 minute Fuse too, and then the Player has had their first Meddle', () => {
  const { state, target } = setup(4);
  const r = step(state, 4, 5, [dare(state, P1, { target, dareKey: 'stunt.torches', firstMeddle: true })]);
  const due = minutesBetween(r.state.world.now, r.diff.fuses.add[0]!.dueAt);
  assert.ok(due >= 2 && due <= 5, `first fuse ${due} min`);
  assert.equal(r.state.players[P1]!.firstMeddleDone, true);
});

const LADDER: Claim[] =['insult', 'mum', 'theft', 'coup'];
const rank = (c: Claim) => Math.max(0, LADDER.indexOf(c)); // a Fear exposed enters at the bottom

/** A Rumour planted by P1 between two plain Captains (no Trait that shifts the odds), and the state an hour and a half later. */
function planted(opts: { claim?: Claim; seed?: number; source?: string; target?: string } = {}) {
  const base = freshWorld({ seed: opts.seed ?? 1, players: [P1] });
  const plain = activeIds(base, (id) => !base.captains[id]!.traits.some((t) => t === 'Gullible' || t === 'Compulsive Liar'));
  const source = opts.source ?? plain[0]!;
  const target = opts.target ?? plain[1]!;
  const intent = rumour(base, P1, { source, target, claim: opts.claim });
  const { state } = step(base, 1, 5, [intent]);
  const later: WorldState = { ...state, world: { ...state.world, tickSeq: state.world.tickSeq + 1, now: addMinutes(state.world.now, 95) } };
  return { state: later, intent, source, target };
}

/** Lands the planted Rumour with a given tick seed. */
function land(state: WorldState, seed: number) {
  const { facts, stateDiff } = simulate(state, [], seed);
  const head = facts.find((f) => f.kind === 'rumour');
  assert.ok(head && head.kind === 'rumour', 'the Rumour lands');
  return { head, facts, diff: stateDiff, next: applyDiff(state, stateDiff) };
}

test('a due Fuse lands the Rumour: a templated story head, with Blame on its Player, and the Meddle is no longer pending', () => {
  const { state, intent, source, target } = planted();
  const { head, diff, next } = land(state, 7);
  assert.equal(head.storyNo, head.no);
  assert.equal(head.tier, 'templated');
  assert.equal(head.meddleId, intent.id);
  assert.equal(head.source, source);
  assert.equal(head.intended, target);
  assert.ok(head.cast.includes(source) && head.cast.includes(head.reached));
  assert.ok(head.templateId?.startsWith('rumour.'));
  assert.doesNotMatch(head.line, /[{}]/);
  assert.ok(head.line.includes(content.cast.find((c) => c.id === head.reached)!.name), head.line);
  assert.deepEqual(
    head.blame.map((b) => [b.meddleId, b.playerId, b.verb, b.landedFact, b.hops]),
    [[intent.id, P1, 'rumour', head.no, 0]],
  );
  assert.ok((head.comedyWeight ?? 0) >= 2, 'heads are weighed, Meddle-caused counts');
  assert.deepEqual(diff.meddles, [{ id: intent.id, status: 'landed', landedFact: head.no }]);
  assert.equal(next.meddles[intent.id], undefined);
  assert.equal(next.fuses.length, 0, 'the Fuse is spent');
});

test('across many seeds, Rumours work about 50%, reach the wrong orc about 30% and Garble about 20%', () => {
  const { state } = planted();
  const n = Math.max(3000, SEEDS * 100);
  const counts = { works: 0, wrong_orc: 0, garbled: 0 };
  for (let seed = 1; seed <= n; seed++) counts[land(state, seed).head.outcome]++;
  assert.ok(Math.abs(counts.works / n - 0.5) < 0.03, `works ${counts.works / n}`);
  assert.ok(Math.abs(counts.wrong_orc / n - 0.3) < 0.03, `wrong orc ${counts.wrong_orc / n}`);
  assert.ok(Math.abs(counts.garbled / n - 0.2) < 0.03, `garbled ${counts.garbled / n}`);
});

test('every Garble escalates up the ladder (insult → mum → betrayal → coup), sometimes into an absurd subject', () => {
  for (const claim of ['insult', 'fear', 'mum', 'theft', 'coup'] as Claim[]) {
    const { state, target } = planted({ claim });
    let garbles = 0;
    let absurd = 0;
    for (let seed = 1; seed <= Math.max(400, SEEDS * 20); seed++) {
      const { head } = land(state, seed);
      if (head.outcome !== 'garbled') {
        assert.equal(head.garbledTo, undefined);
        continue;
      }
      garbles++;
      assert.equal(head.reached, target, 'a Garble still reaches the target');
      assert.equal(head.claim, claim, 'the Fact keeps what was planted');
      const to = head.garbledTo!;
      const escalated = rank(to) > rank(claim) || (claim === 'coup' && to === 'coup' && head.subject.from === 'absurd');
      assert.ok(escalated, `${claim} garbled to ${to} about ${JSON.stringify(head.subject)}`);
      if (head.subject.from === 'absurd') {
        absurd++;
        assert.ok(content.banks.absurdSubjects[head.subject.key], head.subject.key);
      }
    }
    assert.ok(garbles > 20, `${claim}: ${garbles} Garbles`);
    if (claim !== 'coup') assert.ok(absurd > 0 && absurd < garbles, `${claim}: absurd subjects some of the time`);
  }
});

test('a wrong-orc Rumour reaches another active Captain, preferring one who shares the subject', () => {
  const { state, source, target } = planted();
  const subjectTrait = state.captains[target]!.traits[0];
  const sharers = activeIds(state, (id) => id !== source && id !== target && state.captains[id]!.traits.includes(subjectTrait));
  const others = activeIds(state, (id) => id !== source && id !== target).length - sharers.length;
  let toSharer = 0;
  let wrong = 0;
  for (let seed = 1; seed <= 2000; seed++) {
    const { head } = land(state, seed);
    if (head.outcome !== 'wrong_orc') continue;
    wrong++;
    assert.notEqual(head.reached, source);
    assert.notEqual(head.reached, target);
    assert.equal(state.captains[head.reached]!.roster, 'active');
    if (sharers.includes(head.reached)) toSharer++;
  }
  if (sharers.length > 0) {
    const fair = sharers.length / (sharers.length + others);
    assert.ok(toSharer / wrong > fair + 0.1, `sharers get ${toSharer / wrong}, a fair share is ${fair}`);
  }
});

test('a landed Rumour drops the hearer’s affinity toward the source and leaves a permanent Grudge tag', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { state, source } = planted();
    const { head, facts, diff, next } = land(state, seed);
    const key = `${head.reached}>${source}` as const;
    const before = state.affinity[key] ?? 0;
    assert.ok(next.affinity[key]! < before, `${key} fell from ${before} to ${next.affinity[key]}`);
    assert.ok(next.affinity[key]! >= -100);
    const grudge = facts.find((f) => f.kind === 'grudge');
    assert.ok(grudge && grudge.kind === 'grudge');
    assert.equal(grudge.storyNo, head.no, 'a consequence of the Rumour');
    assert.equal(grudge.holder, head.reached);
    assert.equal(grudge.toward, source);
    assert.ok(grudge.delta < 0);
    // A Clash later in the tick (a Hothead going for the source) moves it again; otherwise it's all the Rumour.
    if (!facts.some((f) => f.kind === 'clash')) assert.equal(grudge.delta, next.affinity[key]! - before);
    // A Clash in the same tick (a Hothead, or an old Grudge) leaves tags of its own.
    const tags = diff.grudgeTags.filter((t) => t.cause?.fact === head.no);
    assert.equal(tags.length, 1);
    const tag = tags[0]!;
    assert.deepEqual([tag.holder, tag.toward, tag.cause?.fact], [head.reached, source, head.no]);
    assert.equal(tag.tag, grudge.tag);
    assert.ok(next.grudgeTags.some((t) => t.no === tag.no));
  }
});

test('affinity is clamped at −100 however many Rumours land on one pair', () => {
  let state = freshWorld({ seed: 3, players: [P1] });
  const gullible = activeIds(state).find((id) => !state.captains[id]!.traits.includes('Compulsive Liar'))!;
  const target = activeIds(state).find((id) => id !== gullible)!;
  // Make the target Gullible so every Rumour reaches him; plant six coup plots at once.
  state = { ...state, captains: { ...state.captains, [target]: { ...state.captains[target]!, traits: ['Gullible', 'Lazy'] } } };
  state = { ...state, players: { [P1]: { ...state.players[P1]!, meddles: 6 } } };
  const intents = Array.from({ length: 6 }, () =>
    rumour(state, P1, { source: gullible, target, claim: 'coup', subject: { from: 'trait', key: 'Lazy' } }),
  );
  state = step(state, 1, 5, intents).state;
  const r = step(state, 1, 95);
  const landed = r.facts.filter((f) => f.kind === 'rumour');
  assert.equal(landed.length, 6);
  const toTarget = landed.filter((f) => f.kind === 'rumour' && f.reached === target).length;
  assert.ok(toTarget >= 3, `${toTarget} reached him`);
  assert.equal(r.state.affinity[`${target}>${gullible}`], -100);
  for (const v of Object.values(r.state.affinity)) assert.ok(v >= -100 && v <= 100);
});

test('Traits shift the odds: a Gullible target never Garbles it, a Compulsive Liar source Garbles more', () => {
  const base = planted();
  const tweak = (id: string, traits: [string, string]) => ({
    ...base.state,
    captains: { ...base.state.captains, [id]: { ...base.state.captains[id]!, traits } },
  });
  const garbleRate = (state: WorldState) => {
    let g = 0;
    for (let seed = 1; seed <= 2000; seed++) if (land(state, seed).head.outcome === 'garbled') g++;
    return g / 2000;
  };
  const target = base.state.captains[base.target]!;
  assert.equal(garbleRate(tweak(base.target, ['Gullible', target.traits[0]])), 0);
  assert.ok(garbleRate(tweak(base.source, ['Compulsive Liar', 'Lazy'])) > 0.28);
});

test('after an outage every overdue Fuse fires on the next tick, in (dueAt, no) order, with one ambient roll at most', () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    let state = freshWorld({ seed, players: [P1], watched: true });
    const [a, b, c] = activeIds(state);
    state = { ...state, players: { [P1]: { ...state.players[P1]!, meddles: 6 } } };
    const intents = [
      rumour(state, P1, { source: a!, target: b! }),
      rumour(state, P1, { source: b!, target: c! }),
      rumour(state, P1, { source: c!, target: a! }),
      rumour(state, P1, { source: a!, target: c! }),
    ];
    state = step(state, seed, 5, intents).state;
    // Pin the due times so two share one, with the later-numbered Fuse first in the list.
    const [f1, f2, f3, f4] = [...state.fuses].sort((x, y) => x.no - y.no);
    const due = (f: typeof f1, m: number) => ({ ...f!, dueAt: addMinutes(state.world.now, m) });
    state = { ...state, fuses: [due(f4, 30), due(f3, 50), due(f1, 50), due(f2, 20)] };

    const r = step(state, seed, 6 * 60);
    // Each one lands, or is held if an earlier one in the tick got its target killed.
    const fired = r.diff.meddles.filter((m) => m.status !== 'pending').map((m) => m.id);
    const byFuse = (f: typeof f1) => f!.meddleId;
    assert.deepEqual(fired, [byFuse(f2), byFuse(f4), byFuse(f1), byFuse(f3)], 'due order, then Fuse number');
    assert.equal(r.state.fuses.length, 0);
    const held = r.diff.meddles.filter((m) => m.status === 'held').length;
    assert.equal(Object.keys(r.state.meddles).length, held);
    const incidents = r.facts.filter((f) => f.kind === 'incident' && f.trigger === 'ambient').length;
    assert.ok(incidents <= 1, `${incidents} ambient incidents after a 6-hour gap: never back-filled`);
  }
});

test('a Fuse that is not due yet waits', () => {
  const { state } = planted();
  const early = { ...state, world: { ...state.world, now: addMinutes(state.world.now, -95 + 9) } };
  const { facts, stateDiff } = simulate(early, [], 1);
  assert.equal(facts.filter((f) => f.kind === 'rumour').length, 0);
  assert.deepEqual(stateDiff.fuses.remove, []);
});

test('an invalid Rumour is rejected and its Meddle refunded', () => {
  const { state, source, target } = setup();
  const reserve = Object.keys(state.captains).find((id) => state.captains[id]!.roster === 'reserve')!;
  const notHisTrait = ['Glutton', 'Vain', 'Coward'].find((t) => !state.captains[target]!.traits.includes(t))!;
  const cases = [
    { why: 'unknown Captain', intent: rumour(state, P1, { source: 'nobody', target }) },
    { why: 'source is target', intent: rumour(state, P1, { source: target, target }) },
    { why: 'target in reserve', intent: rumour(state, P1, { source, target: reserve, subject: { from: 'trait', key: 'Glutton' } }) },
    { why: 'not his Trait', intent: rumour(state, P1, { source, target, subject: { from: 'trait', key: notHisTrait } }) },
    { why: 'not his Fear', intent: rumour(state, P1, { source, target, subject: { from: 'fear', key: 'Not A Fear' } }) },
    { why: 'no such Trophy', intent: rumour(state, P1, { source, target, subject: { from: 'trophy', key: 'nose-ring' } }) },
    { why: 'unknown Claim', intent: { ...rumour(state, P1, { source, target }), claim: 'slander' } as never },
  ];
  for (const { why, intent } of cases) {
    const spent = { ...state, players: { [P1]: { ...state.players[P1]!, meddles: 2 } } };
    const r = step(spent, 1, 5, [intent]);
    assert.equal(r.diff.intents.length, 1, why);
    assert.equal(r.diff.intents[0]!.status, 'rejected', why);
    assert.ok(r.diff.intents[0]!.reason, `${why}: a reason is given`);
    assert.equal(r.diff.newMeddles.length, 0, why);
    assert.equal(r.diff.fuses.add.length, 0, why);
    assert.equal(r.state.players[P1]!.meddles, 3, `${why}: the Meddle comes back`);
  }
});
