// #29 Blame chains (data-model §2, decisions 8 and 9): Blame is carried only through the state a
// Template required, one hop per link, deduped, and cut off past 6 hops.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDiff, BLAME, chain, pairCauses, simulate, type BlameEntry, type Cause, type WorldState } from '@orc/sim';
import { activeIds, addMinutes, freshWorld, rumour, step } from './support.ts';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const M1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const M2 = 'aaaaaaaa-0000-4000-8000-000000000002';

/** A Rumour by `playerId` planted from `source` about `target`, landed 95 minutes later. */
function landRumour(state: WorldState, playerId: string, source: string, target: string, seed = 7) {
  const intent = rumour(state, playerId, { source, target });
  const planted = step(state, seed, 5, [intent]).state;
  const later: WorldState = {
    ...planted,
    world: { ...planted.world, tickSeq: planted.world.tickSeq + 1, prevTickAt: planted.world.now, now: addMinutes(planted.world.now, 95) },
  };
  const { facts, stateDiff } = simulate(later, [], seed);
  const head = facts.find((f) => f.kind === 'rumour');
  assert.ok(head && head.kind === 'rumour', 'the Rumour lands');
  return { intent, head, facts, next: applyDiff(later, stateDiff) };
}

const hops = (blame: BlameEntry[]) => blame.map((b) => [b.meddleId, b.playerId, b.hops]);

function entry(meddleId: string, playerId: string, landedFact: number, hopsFromLanding: number): BlameEntry {
  return { meddleId, playerId, verb: 'rumour', landedFact, landedAt: `2026-10-30T12:0${landedFact % 10}:00.000Z`, hops: hopsFromLanding };
}

test("a Rumour's landing Fact has Blame at hop 0, and a Fact caused by its Grudge tag has hop 1", () => {
  const base = freshWorld({ seed: 1, players: [P1] });
  const [source, target] = activeIds(base);
  const { intent, head, facts, next } = landRumour(base, P1, source!, target!);

  assert.deepEqual(hops(head.blame), [[intent.id, P1, 0]]);
  assert.deepEqual(head.causes, [], 'a Meddle landing is caused by nothing in the world');
  const grudge = facts.find((f) => f.kind === 'grudge')!;
  assert.deepEqual(grudge.causes, [head.no], 'the Grudge follows from the Rumour');
  assert.deepEqual(hops(grudge.blame), [[intent.id, P1, 0]], 'the same Meddle, so still hop 0');

  // A later event that needs the hearer's Grudge (a Clash, say) takes that pair's tags as its causes.
  const causes = pairCauses(next.grudgeTags, head.reached, source!, next.world.now);
  assert.deepEqual(causes.map((c) => c.fact), [head.no]);
  const linked = chain({ requires: causes });
  assert.deepEqual(linked.causes, [head.no]);
  assert.deepEqual(hops(linked.blame), [[intent.id, P1, 1]]);
  assert.equal(linked.blame[0]!.landedFact, head.no);
  assert.equal(linked.blame[0]!.landedAt, head.at);
});

test('Grudges seeded at casting carry no Blame', () => {
  const state = freshWorld({ seed: 1 });
  const old = state.grudgeTags[0]!;
  assert.equal(old.cause, null);
  assert.deepEqual(pairCauses(state.grudgeTags, old.holder, old.toward, state.world.now), []);
});

/** Lands a Rumour from `source` about `target`, trying seeds until it reaches the target himself. */
function landOnTarget(state: WorldState, playerId: string, source: string, target: string) {
  for (let seed = 1; ; seed++) {
    const landed = landRumour(state, playerId, source, target, seed);
    if (landed.head.reached === target) return landed;
  }
}

test("Blame from two Players' Meddles merges, deduped, with the right hops", () => {
  // Both Players' Rumours make the same Captain hate the same source: one pair, two Grudge tags.
  const base = freshWorld({ seed: 2, players: [P1, P2] });
  const [source, target] = activeIds(base);
  const first = landOnTarget(base, P1, source!, target!);
  const second = landOnTarget(first.next, P2, source!, target!);
  const state = second.next;

  const causes = pairCauses(state.grudgeTags, target!, source!, state.world.now);
  assert.deepEqual(causes.map((c) => c.fact), [second.head.no, first.head.no], 'newest tag first');
  const clash = chain({ requires: causes });
  assert.deepEqual(clash.causes, [first.head.no, second.head.no]);
  assert.deepEqual(
    hops(clash.blame),
    [
      [first.intent.id, P1, 1],
      [second.intent.id, P2, 1],
    ],
    'both Players, in landing order, one hop away',
  );

  // One step on, a Meddle reached by two paths (directly and through the Clash) keeps its nearest hop.
  const later = chain({ requires: [{ fact: 9_000, blame: clash.blame }, causes[1]!] });
  assert.deepEqual(later.causes, [first.head.no, 9_000]);
  assert.deepEqual(hops(later.blame), [
    [first.intent.id, P1, 1],
    [second.intent.id, P2, 2],
  ]);
});

test('a pair contributes only its newest 3 Grudge tags from the last 7 days', () => {
  const tag = (no: number, daysAgo: number, withCause = true) => ({
    no,
    holder: 'a',
    toward: 'b',
    tag: `tag ${no}`,
    at: new Date(Date.parse('2026-10-30T12:00:00.000Z') - daysAgo * 86_400_000).toISOString(),
    cause: withCause ? { fact: no, blame: [] } : null,
  });
  const tags = [tag(1, 1), tag(2, 8), tag(3, 1), tag(4, 1, false), tag(5, 1), tag(6, 1), { ...tag(7, 0), holder: 'b', toward: 'a' }];
  const now = '2026-10-30T12:00:00.000Z';
  assert.deepEqual(pairCauses(tags, 'a', 'b', now).map((c) => c.fact), [6, 5], 'tag 4 is old history');
  assert.deepEqual(pairCauses(tags.slice(0, 3), 'a', 'b', now).map((c) => c.fact), [3, 1], 'older than 7 days is out');
});

test('Blame entries deduplicate per Meddle and sort by landing', () => {
  const x: Cause = { fact: 10, blame: [entry(M2, P2, 4, 2), entry(M1, P1, 3, 0)] };
  const y: Cause = { fact: 11, blame: [entry(M1, P1, 3, 4)] };
  const { causes, blame } = chain({ requires: [y, x, x] });
  assert.deepEqual(causes, [10, 11]);
  assert.deepEqual(hops(blame), [
    [M1, P1, 1],
    [M2, P2, 3],
  ]);
});

test('a chain longer than 6 hops drops the far entries', () => {
  let cause: Cause = { fact: 1, blame: [entry(M1, P1, 1, 0)] };
  const p1Hops: number[] = [];
  for (let n = 2; n <= 9; n++) {
    // P2's Meddle joins the chain at Fact 4, so the far end (P1) drops while the near end stays.
    const own = n === 4 ? [entry(M2, P2, n, 0)] : [];
    const { blame } = chain({ requires: [cause], own });
    p1Hops.push(blame.find((b) => b.meddleId === M1)?.hops ?? -1);
    cause = { fact: n, blame };
  }
  assert.deepEqual(p1Hops, [1, 2, 3, 4, 5, 6, -1, -1], 'hop 6 is the last one kept');
  assert.deepEqual(hops(cause.blame), [[M2, P2, 5]]);
  assert.equal(BLAME.hopCap, 6);
});

test('a Callback alone never adds Blame', () => {
  const tagCause: Cause = { fact: 5, blame: [entry(M1, P1, 5, 0)] };
  const only = chain({ callbacks: [tagCause] });
  assert.deepEqual(only.causes, []);
  assert.deepEqual(only.blame, []);
  assert.equal(only.callbacks, 1, 'it still counts for comedy weight');

  const both = chain({ requires: [{ fact: 6, blame: [] }], callbacks: [tagCause] });
  assert.deepEqual(both.causes, [6]);
  assert.deepEqual(both.blame, []);
});

test('ambient incidents carry no causes and no Blame', () => {
  let state = freshWorld({ seed: 4, players: [P1], watched: true });
  let incidents = 0;
  for (let i = 0; i < 30; i++) {
    const r = step(state, 4);
    state = r.state;
    for (const f of r.facts.filter((x) => x.kind === 'incident' && x.trigger === 'ambient')) {
      incidents++;
      assert.deepEqual([f.causes, f.blame], [[], []]);
    }
  }
  assert.ok(incidents > 0);
});
