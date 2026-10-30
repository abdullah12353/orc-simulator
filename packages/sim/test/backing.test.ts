// #36 Backing and gold (D33–D36): a daily Stipend banked to 30, standing Stakes on Captains, a small Clash
// edge per backer, and payouts on wins and (mostly) Infamy. Gold is private: no Fact ever carries it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, type CaptainId, type Fact, type Intent, type StateDiff, type WorldState } from '@orc/sim';
import { activeIds, freshWorld, SEEDS, step } from './support.ts';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// 23:55 London on 30 Oct 2026 is 23:55 UTC, so the next 5-minute tick crosses midnight.
const BEFORE_MIDNIGHT = '2026-10-30T23:55:00.000Z';

let counter = 0;
const nextId = () => `36360000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

/** A `back` intent as submit_intent queues it: the Stake's gold already taken from the Player. */
function back(state: WorldState, playerId: string, captainId: CaptainId, amount: number): { state: WorldState; intent: Intent } {
  const p = state.players[playerId]!;
  assert.ok(p.gold >= amount, 'submit_intent refuses a Stake larger than your gold');
  return {
    state: { ...state, players: { ...state.players, [playerId]: { ...p, gold: p.gold - amount } } },
    intent: { id: nextId(), playerId, at: state.world.now, kind: 'back', captainId, amount },
  };
}

function withdraw(state: WorldState, playerId: string, captainId: CaptainId): Intent {
  return { id: nextId(), playerId, at: state.world.now, kind: 'withdraw', captainId };
}

/** Submits `back`s (debited at once) and steps one tick. */
function backAndStep(state: WorldState, stakes: [string, CaptainId, number][], extra: Intent[] = []) {
  const intents: Intent[] = [];
  for (const [p, c, amount] of stakes) {
    const r = back(state, p, c, amount);
    state = r.state;
    intents.push(r.intent);
  }
  return step(state, undefined, 5, [...intents, ...extra]);
}

function withGold(state: WorldState, gold: Record<string, number>): WorldState {
  const players = Object.fromEntries(Object.entries(state.players).map(([id, p]) => [id, { ...p, gold: gold[id] ?? p.gold }]));
  return { ...state, players };
}

test('the day roll grants a 10-gold Stipend, banked up to 30, with the overflow logged as lost', () => {
  const state = withGold(freshWorld({ now: BEFORE_MIDNIGHT, players: [A, B, C] }), { [A]: 0, [B]: 25, [C]: 30 });
  const r = step(state);
  assert.deepEqual(
    [A, B, C].map((p) => r.state.players[p]!.gold),
    [10, 30, 30],
  );
  assert.deepEqual(r.diff.ledger, [
    { playerId: A, delta: 10, lost: 0, reason: 'stipend' },
    { playerId: B, delta: 5, lost: 5, reason: 'stipend' },
    { playerId: C, delta: 0, lost: 10, reason: 'stipend' },
  ]);
});

test('the Stipend comes once a day, and there is no reset', () => {
  let state = withGold(freshWorld({ now: BEFORE_MIDNIGHT, players: [A] }), { [A]: 3 });
  for (let i = 0; i < 30; i++) state = step(state).state;
  assert.equal(state.players[A]!.gold, 13);
});

test('a back intent makes a standing Stake, and a second one tops it up', () => {
  const state = freshWorld({ players: [A, B] });
  const [krug, gob] = activeIds(state);
  let r = backAndStep(state, [[A, krug!, 10], [B, krug!, 4], [A, gob!, 1]]);
  assert.deepEqual(r.state.stakes, [
    { playerId: A, captainId: krug, amount: 10 },
    { playerId: A, captainId: gob, amount: 1 },
    { playerId: B, captainId: krug, amount: 4 },
  ].sort((x, y) => (x.playerId + x.captainId < y.playerId + y.captainId ? -1 : 1)));
  assert.equal(r.state.players[A]!.gold, 19, 'debited at submit, nothing more at the tick');
  assert.ok(r.diff.intents.every((i) => i.status === 'consumed'));

  r = backAndStep(r.state, [[A, krug!, 5]]);
  assert.equal(r.state.stakes.find((s) => s.playerId === A && s.captainId === krug)!.amount, 15);
  assert.equal(r.state.players[A]!.gold, 14);
});

test('a withdrawal returns half the Stake, rounded down, at the next tick', () => {
  const state = freshWorld({ players: [A] });
  const [krug] = activeIds(state);
  let r = backAndStep(state, [[A, krug!, 7]]);
  assert.equal(r.state.players[A]!.gold, 23);
  r = step(r.state, undefined, 5, [withdraw(r.state, A, krug!)]);
  assert.deepEqual(r.state.stakes, []);
  assert.equal(r.state.players[A]!.gold, 26, '7 → 3 back');
  assert.deepEqual(r.diff.ledger, [{ playerId: A, delta: 3, lost: 0, reason: 'withdraw', captainId: krug }]);
});

test('a withdrawal past the cap loses the overflow', () => {
  const state = freshWorld({ players: [A] });
  const [krug] = activeIds(state);
  let r = backAndStep(state, [[A, krug!, 20]]);
  r = step(withGold(r.state, { [A]: 25 }), undefined, 5, [withdraw(r.state, A, krug!)]);
  assert.equal(r.state.players[A]!.gold, 30);
  assert.deepEqual(r.diff.ledger, [{ playerId: A, delta: 5, lost: 5, reason: 'withdraw', captainId: krug }]);
});

test('withdrawing a Stake that is gone is rejected; backing a Captain who does not exist is rejected and refunded', () => {
  const state = freshWorld({ players: [A] });
  const [krug] = activeIds(state);
  const nobody = back(state, A, 'nobody-at-all', 6);
  const r = step(nobody.state, undefined, 5, [withdraw(state, A, krug!), nobody.intent]);
  assert.deepEqual(
    r.diff.intents.map((i) => i.status),
    ['rejected', 'rejected'],
  );
  assert.deepEqual(r.diff.ledger, [{ playerId: A, delta: 6, lost: 0, reason: 'refund' }]);
  assert.equal(r.state.players[A]!.gold, 30);
  assert.deepEqual(r.state.stakes, []);
});

test('a Stake is held through death', () => {
  const state = freshWorld({ players: [A] });
  const [krug] = activeIds(state);
  const r = backAndStep(state, [[A, krug!, 5]]);
  const dead: WorldState = {
    ...r.state,
    captains: { ...r.state.captains, [krug!]: { ...r.state.captains[krug!]!, roster: 'dead', returnsAt: '2026-11-02T12:00:00.000Z' } },
  };
  assert.deepEqual(step(dead).state.stakes, [{ playerId: A, captainId: krug, amount: 5 }]);
});

type ClashFact = Extract<Fact, { kind: 'clash' }>;
const isClash = (f: Fact): f is ClashFact => f.kind === 'clash';
const P = [A, B, C, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'];

/**
 * Four disjoint feuding pairs of equal Power and Traits that bend nothing, so each tick throws up Clashes
 * at even odds; the i-th holder is backed by the first `backers[i]` Players (Stakes of `amount`), and
 * every target by the first `targetBackers`.
 */
function arena(backers: number[], amount = 10, targetBackers = 0): { state: WorldState; holders: CaptainId[]; targets: CaptainId[] } {
  const base = freshWorld({ seed: 5, players: P });
  const ids = activeIds(base).filter((id) => id !== base.world.warlordId).slice(0, 8);
  const captains = { ...base.captains };
  const affinity: WorldState['affinity'] = {};
  const stakes: WorldState['stakes'] = [];
  const holders: CaptainId[] = [];
  const targets: CaptainId[] = [];
  for (let i = 0; i < 8; i += 2) {
    const [h, t] = [ids[i]!, ids[i + 1]!];
    captains[h] = { ...captains[h]!, power: 5, traits: ['Snob', 'Hoarder'] };
    captains[t] = { ...captains[t]!, power: 5, traits: ['Snob', 'Hoarder'] };
    affinity[`${h}>${t}`] = -80;
    holders.push(h);
    targets.push(t);
    for (const p of P.slice(0, backers[i / 2] ?? 0)) stakes.push({ playerId: p, captainId: h, amount });
    for (const p of P.slice(0, targetBackers)) stakes.push({ playerId: p, captainId: t, amount });
  }
  stakes.sort((x, y) => (x.playerId + x.captainId < y.playerId + y.captainId ? -1 : 1));
  return { state: { ...base, captains, affinity, stakes, grudgeTags: [], world: { ...base.world, tickSeq: 1 } }, holders, targets };
}

function clashesOver(state: WorldState, n: number): ClashFact[] {
  const out: ClashFact[] = [];
  for (let seed = 1; seed <= n; seed++) out.push(...simulate(state, [], seed).facts.filter(isClash));
  return out;
}

test('the Backing edge is +5% per backer and caps at +10%, however many Players back a Captain', () => {
  const { state, holders } = arena([0, 1, 2, 4]);
  const clashes = clashesOver(state, 400);
  const edgeOf = new Map(clashes.map((c) => [c.a, c.edgeA]));
  assert.deepEqual(holders.map((h) => edgeOf.get(h)), [0, 0.05, 0.1, 0.1]);
  for (const c of clashes) assert.equal(c.edgeB, 0, 'nobody backs the targets');
});

test('a backed Captain wins more often: the edge shifts the roll, and two backed sides partly cancel', () => {
  const n = Math.max(4000, SEEDS * 200);
  const rate = (cs: ClashFact[]) => cs.filter((c) => c.winner === c.a).length / cs.length;
  const backed = clashesOver(arena([2, 2, 2, 2]).state, n);
  assert.ok(backed.every((c) => c.pA === 0.5), 'pA leaves the edge out');
  assert.ok(Math.abs(rate(backed) - 0.6) < 0.035, `backed by 2: a won ${rate(backed)}`);
  const both = clashesOver(arena([2, 2, 2, 2], 10, 1).state, n);
  assert.ok(both.every((c) => c.edgeA === 0.1 && c.edgeB === 0.05));
  assert.ok(Math.abs(rate(both) - 0.55) < 0.035, `10% against 5%: a won ${rate(both)}`);
});

/** Every Clash story over `n` seeds, with the tick's ledger. */
function payoutsOver(state: WorldState, n: number) {
  const out: { head: ClashFact; story: Fact[]; ledger: StateDiff['ledger'] }[] = [];
  for (let seed = 1; seed <= n; seed++) {
    const { facts, stateDiff } = simulate(state, [], seed);
    for (const head of facts.filter(isClash)) {
      const story = facts.filter((f) => f.storyNo === head.no);
      out.push({ head, story, ledger: stateDiff.ledger.filter((l) => l.fact === head.no) });
    }
  }
  return out;
}

/** Every Player broke, so payouts show in full (nothing hits the cap). */
const broke = (state: WorldState) => withGold(state, Object.fromEntries(P.map((p) => [p, 0])));

test('a win pays 10% of the Stake, rounded up, with the Clash as its Fact', () => {
  for (const [amount, pays] of [
    [30, 3],
    [25, 3],
    [1, 1],
  ] as const) {
    const stories = payoutsOver(broke(arena([1, 1, 1, 1], amount).state), 200).filter((s) => s.head.winner === s.head.a);
    assert.ok(stories.length > 20);
    for (const { head, ledger } of stories) {
      assert.deepEqual(
        ledger.filter((l) => l.reason === 'payout_win'),
        [{ playerId: A, delta: pays, lost: 0, reason: 'payout_win', fact: head.no, captainId: head.a }],
        `a ${amount}-gold Stake`,
      );
    }
  }
});

test('Infamy pays 1% of the Stake per point, rounded up, once per story: losing (6) pays 2, losing and drowning (26) pays 8', () => {
  // A backs every target at 30. A lost Clash is 6 Infamy; with a death on top, 26.
  const stories = payoutsOver(broke(arena([0, 0, 0, 0], 30, 1).state), 1500).filter((s) => s.head.loser === s.head.b);
  const infamyOf = (story: Fact[], id: CaptainId) => story.flatMap((f) => f.infamy).filter((g) => g.captainId === id).reduce((s, g) => s + g.amount, 0);
  const paid = (s: (typeof stories)[number]) => s.ledger.filter((l) => l.reason === 'payout_infamy');
  const plain = stories.filter((s) => infamyOf(s.story, s.head.b) === 6);
  const drowned = stories.filter((s) => infamyOf(s.story, s.head.b) === 26);
  assert.ok(plain.length > 10 && drowned.length > 3, `${plain.length} plain losses, ${drowned.length} deaths`);
  for (const s of plain) assert.deepEqual(paid(s), [{ playerId: A, delta: 2, lost: 0, reason: 'payout_infamy', fact: s.head.no, captainId: s.head.b }]);
  for (const s of drowned) assert.deepEqual(paid(s), [{ playerId: A, delta: 8, lost: 0, reason: 'payout_infamy', fact: s.head.no, captainId: s.head.b }]);
  assert.ok(stories.every((s) => s.ledger.every((l) => l.reason !== 'payout_win')), 'the loser\'s backer gets no win');
});

test('payouts bank up to 30 and log the overflow as lost', () => {
  const state = withGold(arena([1, 1, 1, 1], 30).state, { [A]: 29 });
  for (let seed = 1; seed <= 200; seed++) {
    const { stateDiff } = simulate(state, [], seed);
    const wins = stateDiff.ledger.filter((l) => l.reason === 'payout_win');
    if (wins.length === 0) continue;
    assert.deepEqual(wins[0], { ...wins[0], delta: 1, lost: 2 }, 'the first win fills him up');
    for (const w of wins.slice(1)) assert.deepEqual([w.delta, w.lost], [0, 3], 'the rest is lost');
    return;
  }
  assert.fail('no win in 200 seeds');
});

/**
 * Players who back and withdraw on a deterministic whim. `scale` multiplies every Stake they make, so two
 * runs with different scales have the same backers at every moment but different amounts and gold.
 */
function playBacking(worldSeed: number, ticks: number, scale: number) {
  let state = freshWorld({ seed: worldSeed, players: P.slice(0, 3), now: '2026-10-30T20:00:00.000Z' });
  const facts: Fact[] = [];
  const ledger: StateDiff['ledger'] = [];
  for (let i = 0; i < ticks; i++) {
    // Topped up to 15 every tick, so the same choices are affordable whatever the scale.
    state = withGold(state, Object.fromEntries(P.slice(0, 3).map((p) => [p, 15])));
    const intents: Intent[] = [];
    for (const [j, p] of P.slice(0, 3).entries()) {
      const roll = (worldSeed * 7919 + state.world.tickSeq * 104729 + j * 31) % 97;
      if (roll >= 12) continue;
      const ids = Object.keys(state.captains).sort();
      const captainId = ids[(roll * 13 + j) % ids.length]!;
      const staked = state.stakes.some((s) => s.playerId === p && s.captainId === captainId);
      if (staked && roll < 3) intents.push(withdraw(state, p, captainId));
      else {
        const r = back(state, p, captainId, (1 + (roll % 3)) * scale);
        state = r.state;
        intents.push(r.intent);
      }
    }
    const before = state;
    const r = step(state, worldSeed, 5, intents);
    state = r.state;
    facts.push(...r.facts);
    ledger.push(...r.diff.ledger);
    for (const p of P.slice(0, 3)) {
      const gold = state.players[p]!.gold;
      assert.ok(gold >= 0 && gold <= 30, `gold ${gold}`);
      const deltas = r.diff.ledger.filter((l) => l.playerId === p).reduce((s, l) => s + l.delta, 0);
      assert.equal(gold, before.players[p]!.gold + deltas, 'gold moves only by ledger deltas');
    }
    for (const l of r.diff.ledger) assert.ok(l.delta >= 0 && l.lost >= 0 && l.delta + l.lost > 0 || l.reason === 'withdraw');
  }
  return { facts, ledger, state };
}

test('invariant: no Fact carries gold or a Stake amount, and Facts never depend on how much anyone staked', () => {
  const forbidden = /gold|stake|ledger|amount|backer/i;
  const keysOf = (v: unknown, path = ''): string[] =>
    v && typeof v === 'object'
      ? Object.entries(v).flatMap(([k, x]) => [`${path}${k}`, ...keysOf(x, `${path}${k}.`)])
      : [];
  let payouts = 0;
  for (let seed = 1; seed <= Math.max(3, Math.ceil(SEEDS / 4)); seed++) {
    const small = playBacking(seed, 300, 1);
    const big = playBacking(seed, 300, 3);
    payouts += small.ledger.filter((l) => l.reason.startsWith('payout')).length;
    assert.ok(small.state.stakes.length > 0, 'somebody is backing somebody');
    assert.deepEqual(big.facts, small.facts, `seed ${seed}: the same Facts whatever the amounts`);
    for (const f of small.facts) {
      // Infamy entries have an `amount`: Infamy points, which are public. Nothing else may.
      const keys = keysOf({ ...f, infamy: undefined }).filter((k) => forbidden.test(k));
      assert.deepEqual(keys, [], `Fact ${f.no} (${f.kind})`);
      assert.doesNotMatch(f.line, /\bgold\b/i, f.line);
    }
  }
  assert.ok(payouts > 0, 'Stakes paid out along the way');
});

test('the edge counts backers, not gold: a 1-gold Stake gives the same edge as a 30-gold one', () => {
  const edges = (amount: number) => clashesOver(arena([1, 1, 1, 1], amount).state, 200).map((c) => c.edgeA);
  assert.deepEqual(edges(1), edges(30));
});
