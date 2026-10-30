// #35 Dares (Meddle verbs, user stories 42–46): a Dare is a Meddle on a Fuse; it lands botched, pulled off or
// refused, and a botched one can kill, humiliate or topple the Warlord. A Prank leaves its victim a Grudge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content, DARE_TEMPLATES, daresFor } from '@orc/content';
import { applyDiff, DARE, INFAMY, simulate, type CaptainId, type Fact, type WorldState } from '@orc/sim';
import { activeIds, addMinutes, dare, freshWorld, SEEDS, step } from './support.ts';

const P1 = '11111111-1111-4111-8111-111111111111';
const minutesBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 60_000;
type Of<K extends Fact['kind']> = Extract<Fact, { kind: K }>;
const ofKind = <K extends Fact['kind']>(facts: Fact[], kind: K) => facts.filter((f): f is Of<K> => f.kind === kind);
const nameOf = (id: CaptainId) => content.cast.find((c) => c.id === id)!.name;

/** No Fear any test Dare plays on, no grace, no disguise: a plain Captain to Dare. */
function plain(state: WorldState, id: CaptainId, patch: Partial<WorldState['captains'][string]> = {}): WorldState {
  return {
    ...state,
    captains: { ...state.captains, [id]: { ...state.captains[id]!, fears: [{ fear: 'Cats', added: false, since: state.world.now }], graceUntil: null, ...patch } },
  };
}

/** A world with one Player and two ordinary active Captains (neither is the Warlord). */
function setup(seed = 1) {
  const base = freshWorld({ seed, players: [P1] });
  const [target, victim] = activeIds(base, (id) => id !== base.world.warlordId);
  return { state: plain(plain(base, target!), victim!), target: target!, victim: victim! };
}

/** Plants the Dare, then moves the clock past any Fuse. `patch` adjusts the world just before it lands. */
function planted(
  d: { dareKey: string; victim?: CaptainId; target?: CaptainId },
  patch: (s: WorldState, target: CaptainId) => WorldState = (s) => s,
) {
  const s = setup();
  const target = d.target ?? s.target;
  const intent = dare(s.state, P1, { target, dareKey: d.dareKey, ...(d.victim ? { victim: d.victim } : {}) });
  const r = step(s.state, 1, 5, [intent]);
  assert.deepEqual(r.diff.intents, [{ id: intent.id, status: 'consumed' }]);
  const later: WorldState = { ...r.state, world: { ...r.state.world, tickSeq: r.state.world.tickSeq + 1, now: addMinutes(r.state.world.now, 95) } };
  return { state: patch(later, target), intent, target, victim: s.victim };
}

/** Lands the planted Dare with a given tick seed: its head, its story and everything else that happened. */
function land(state: WorldState, seed: number) {
  const { facts, stateDiff } = simulate(state, [], seed);
  const [head] = ofKind(facts, 'dare');
  assert.ok(head, 'the Dare lands');
  return { head, story: facts.filter((f) => f.storyNo === head.no), facts, diff: stateDiff, next: applyDiff(state, stateDiff) };
}

/** The first seed (from 1) whose landing has this outcome. */
function landWith(state: WorldState, outcome: Of<'dare'>['outcome'], start = 1) {
  for (let seed = start; seed < start + 500; seed++) {
    const r = land(state, seed);
    if (r.head.outcome === outcome) return { ...r, seed };
  }
  throw new Error(`no ${outcome} in 500 seeds`);
}

test('a Dare intent becomes a pending Meddle on a 10–90 minute Fuse (2–5 for a first Meddle), and nothing is said', () => {
  const minutes = new Set<number>();
  for (let seed = 1; seed <= Math.max(100, SEEDS * 5); seed++) {
    const { state, target, victim } = setup(seed);
    const intent = dare(state, P1, { target, dareKey: 'prank.frog-helmet', victim });
    const r = step(state, seed, 5, [intent]);
    assert.deepEqual(r.diff.intents, [{ id: intent.id, status: 'consumed' }]);
    assert.deepEqual(r.diff.newMeddles, [
      { id: intent.id, playerId: P1, intent: { kind: 'dare', target, dareKey: 'prank.frog-helmet', victim, firstMeddle: false }, status: 'pending', heldOn: null },
    ]);
    const fuse = r.diff.fuses.add.find((f) => f.meddleId === intent.id)!;
    const m = minutesBetween(r.state.world.now, fuse.dueAt);
    assert.ok(Number.isInteger(m) && m >= 10 && m <= 90, `fuse of ${m} min`);
    minutes.add(m);
    assert.equal(r.state.players[P1]!.meddles, 3, 'debited at submit: the tick charges nothing');
    for (const f of r.facts) assert.ok(!JSON.stringify(f).includes(intent.id), 'no Fact carries a pending Meddle');

    const first = step(state, seed, 5, [dare(state, P1, { target, dareKey: 'stunt.torches', firstMeddle: true })]);
    const due = minutesBetween(first.state.world.now, first.diff.fuses.add.find((f) => f.meddleId)!.dueAt);
    assert.ok(due >= 2 && due <= 5, `first fuse ${due} min`);
  }
  assert.ok(Math.min(...minutes) <= 15 && Math.max(...minutes) >= 85, 'fuses spread over 10–90');
});

test('a Dare the target cannot take, or a Prank without a proper victim, is rejected and its Meddle refunded', () => {
  const { state, target, victim } = setup();
  const notVain = activeIds(state, (id) => !state.captains[id]!.traits.includes('Vain'))[0]!;
  const benched = Object.keys(state.captains).find((id) => state.captains[id]!.roster === 'reserve')!;
  const cases: [Parameters<typeof dare>[2], string][] = [
    [{ target, dareKey: 'stunt.no-such-dare' }, 'bad_dare'],
    [{ target: notVain, dareKey: 'stunt.mirror' }, 'bad_dare'],
    [{ target: 'nobody', dareKey: 'stunt.torches' }, 'unknown_captain'],
    [{ target: benched, dareKey: 'stunt.torches' }, 'benched_captain'],
    [{ target, dareKey: 'prank.frog-helmet' }, 'bad_victim'],
    [{ target, dareKey: 'stunt.torches', victim }, 'bad_victim'],
    [{ target, dareKey: 'prank.frog-helmet', victim: target }, 'bad_victim'],
    [{ target, dareKey: 'prank.frog-helmet', victim: 'nobody' }, 'bad_victim'],
    [{ target, dareKey: 'prank.frog-helmet', victim: benched }, 'bad_victim'],
    [{ target, dareKey: 'surprise', victim }, 'bad_victim'],
  ];
  for (const [d, reason] of cases) {
    const intent = dare(state, P1, d);
    const r = step(state, 1, 5, [intent]);
    assert.deepEqual(r.diff.intents, [{ id: intent.id, status: 'rejected', reason }], JSON.stringify(d));
    assert.equal(r.diff.newMeddles.length, 0);
    assert.equal(r.state.players[P1]!.meddles, 4, 'refunded');
  }
});

test('a landed Dare is a templated story head with Blame on its Player, and the Meddle is spent', () => {
  const { state, intent, target } = planted({ dareKey: 'stunt.torches' });
  for (const outcome of ['botched', 'pulled_off', 'refused'] as const) {
    const { head, diff, next } = landWith(state, outcome);
    assert.equal(head.storyNo, head.no);
    assert.equal(head.tier, 'templated');
    assert.equal(head.templateId, DARE_TEMPLATES.stunt[outcome]);
    assert.equal(head.meddleId, intent.id);
    assert.equal(head.dareKey, 'stunt.torches');
    assert.equal(head.target, target);
    assert.equal(head.victim, undefined);
    assert.equal(head.playsOnFear, false);
    assert.deepEqual(head.cast, [target]);
    assert.ok(head.line.includes(nameOf(target)) && head.line.includes('juggle three lit torches'), head.line);
    assert.doesNotMatch(head.line, /[{}]/);
    assert.deepEqual(head.blame.map((b) => [b.meddleId, b.playerId, b.verb, b.landedFact, b.hops]), [[intent.id, P1, 'dare', head.no, 0]]);
    assert.ok(diff.meddles.some((m) => m.id === intent.id && m.status === 'landed' && m.landedFact === head.no));
    assert.equal(next.meddles[intent.id], undefined);
  }
});

test('across many seeds, Dares are botched about 60%, pulled off about 20% and refused about 20%', () => {
  const { state } = planted({ dareKey: 'stunt.torches' });
  const n = Math.max(3000, SEEDS * 100);
  const counts = { botched: 0, pulled_off: 0, refused: 0 };
  for (let seed = 1; seed <= n; seed++) counts[land(state, seed).head.outcome]++;
  assert.ok(Math.abs(counts.botched / n - 0.6) < 0.03, `botched ${counts.botched / n}`);
  assert.ok(Math.abs(counts.pulled_off / n - 0.2) < 0.03, `pulled off ${counts.pulled_off / n}`);
  assert.ok(Math.abs(counts.refused / n - 0.2) < 0.03, `refused ${counts.refused / n}`);
});

test('a Dare that plays on his Fear says so, and goes wrong more often', () => {
  const { state } = planted({ dareKey: 'stunt.moat-swim' }, (s, t) => plain(s, t, { fears: [{ fear: 'Water', added: false, since: s.world.now }] }));
  const n = Math.max(1000, SEEDS * 50);
  let botched = 0;
  for (let seed = 1; seed <= n; seed++) {
    const { head } = land(state, seed);
    assert.equal(head.playsOnFear, true);
    assert.match(head.line, /fear of water/, head.line);
    if (head.outcome === 'botched') botched++;
  }
  assert.ok(botched / n > 0.6 + 0.05, `botched ${botched / n}`);
  assert.ok(Math.abs(botched / n - DARE.fearOdds.botched / 100) < 0.04, `botched ${botched / n}`);
});

test('Infamy for the target: pulled off +5, refused +8, botched +20', () => {
  const { state, target } = planted({ dareKey: 'stunt.torches' });
  const want = { pulled_off: INFAMY.dare.pulledOff, refused: INFAMY.dare.refused, botched: INFAMY.dare.botched };
  for (const outcome of ['botched', 'pulled_off', 'refused'] as const) {
    const { head } = landWith(state, outcome);
    assert.deepEqual(head.infamy, [{ captainId: target, amount: want[outcome] }], outcome);
  }
});

test('a botched Dare can kill (cause "botched"), or humiliate him, and the death cap still holds', () => {
  const { state, target } = planted({ dareKey: 'stunt.torches' });
  let deaths = 0;
  let humiliated = 0;
  for (let seed = 1; seed <= Math.max(600, SEEDS * 30); seed++) {
    const { head, story } = land(state, seed);
    const [death] = ofKind(story, 'death');
    const humiliations = ofKind(story, 'humiliation');
    if (head.outcome !== 'botched') {
      assert.equal(death, undefined, `${head.outcome} never kills`);
      assert.equal(humiliations.length, 0);
      continue;
    }
    if (death) {
      deaths++;
      assert.equal(death.captainId, target);
      assert.equal(death.causeTag, 'botched');
      assert.deepEqual(death.causes, [head.no]);
      assert.equal(death.blame[0]!.hops, 1, 'Blame carries to the death');
    } else if (humiliations.length > 0) {
      humiliated++;
      const [h] = humiliations;
      assert.equal(h!.captainId, target);
      assert.ok(content.banks.humiliations[h!.key]!.causes.includes('botched'), h!.key);
      assert.deepEqual(h!.causes, [head.no]);
    }
  }
  assert.ok(deaths > 0 && humiliated > 0, `${deaths} deaths, ${humiliated} humiliated`);

  // At the day's death cap he lives, Humiliated instead.
  const capped: WorldState = { ...state, world: { ...state.world, deathsToday: 3 } };
  for (let seed = 1; seed <= 300; seed++) {
    const { story } = land(capped, seed);
    assert.equal(ofKind(story, 'death').length, 0);
  }
});

test('a botched Dare by the Warlord makes him fall, and succession runs', () => {
  const base = freshWorld({ seed: 1, players: [P1] });
  const warlord = base.world.warlordId!;
  const { state } = planted({ dareKey: 'stunt.torches', target: warlord }, (s, t) => plain(s, t));
  const { head, story, facts, diff } = landWith(state, 'botched');
  const [fell] = ofKind(story, 'warlord_fell');
  assert.ok(fell, 'he falls');
  assert.equal(fell.captainId, warlord);
  assert.equal(fell.why, 'botched_dare');
  assert.deepEqual(fell.causes, [head.no]);
  assert.equal(ofKind(facts, 'warlord_fell').length, 1, 'once, even if the Dare kills him too');
  assert.ok(head.line.length > 0 && content.banks.throne.fell.botched_dare.some((l) => head.line.includes(l.replace('{captain}', nameOf(warlord)))), head.line);
  const [crowned] = ofKind(facts, 'crowned');
  assert.ok(crowned, 'a successor is crowned');
  assert.equal(crowned.previous, warlord);
  assert.notEqual(crowned.intro.captainId, warlord);
  assert.ok(crowned.causes.includes(fell.no), 'the crowning requires the fall');
  for (const no of crowned.causes.filter((n) => n !== fell.no)) {
    assert.ok(facts.find((f) => f.no === no)?.infamy.some((g) => g.captainId === crowned.intro.captainId), 'and what won him the throne this week');
  }
  assert.equal(crowned.blame[0]?.meddleId, head.meddleId, 'the crowning is on the Dare too');
  assert.equal(diff.world.warlordId, crowned.intro.captainId);

  for (const outcome of ['pulled_off', 'refused'] as const) {
    const other = landWith(state, outcome);
    assert.equal(ofKind(other.facts, 'warlord_fell').length, 0, `${outcome}: he keeps the throne`);
  }
});

test('a Prank on a victim creates a Grudge tag from the victim towards the target, with Blame carried', () => {
  const { state, intent, target, victim } = planted({ dareKey: 'prank.frog-helmet', victim: setup().victim });
  for (const outcome of ['pulled_off', 'botched'] as const) {
    const { head, story, diff, next } = landWith(state, outcome);
    assert.equal(head.victim, victim);
    assert.deepEqual(head.cast, [target, victim]);
    assert.equal(head.templateId, DARE_TEMPLATES.prank[outcome]);
    assert.ok(head.line.includes(nameOf(victim)) && head.line.includes(`${nameOf(victim)}'s helmet`), head.line);

    const [grudge] = ofKind(story, 'grudge');
    assert.ok(grudge, `${outcome}: a Grudge`);
    assert.equal(grudge.holder, victim);
    assert.equal(grudge.toward, target);
    assert.equal(grudge.tag, 'put a frog in his helmet');
    assert.ok(grudge.delta < 0);
    assert.deepEqual(grudge.causes, [head.no]);
    assert.deepEqual(grudge.blame.map((b) => [b.meddleId, b.verb, b.hops]), [[intent.id, 'dare', 0]]);

    const tag = diff.grudgeTags.find((t) => t.holder === victim && t.toward === target)!;
    assert.ok(tag, 'a permanent tag');
    assert.equal(tag.tag, 'put a frog in his helmet');
    assert.equal(tag.cause?.fact, head.no);
    assert.deepEqual(tag.cause?.blame.map((b) => b.meddleId), [intent.id], 'the tag carries the Blame on');
    assert.equal(next.affinity[`${victim}>${target}`], (state.affinity[`${victim}>${target}`] ?? 0) + grudge.delta);
  }
  const { head, story, diff } = landWith(state, 'refused');
  assert.equal(ofKind(story, 'grudge').length, 0, 'a refused Prank leaves no Grudge');
  assert.equal(diff.grudgeTags.filter((t) => t.cause?.fact === head.no).length, 0);
});

test('a pranked Hothead goes straight for whoever did it', () => {
  const base = freshWorld({ seed: 1, players: [P1] });
  const hothead = activeIds(base, (id) => id !== base.world.warlordId && base.captains[id]!.traits.includes('Hothead'))[0]!;
  const target = activeIds(base, (id) => id !== base.world.warlordId && id !== hothead)[0]!;
  const { state } = planted({ dareKey: 'prank.frog-helmet', victim: hothead, target });
  const { head, facts } = landWith(state, 'pulled_off');
  const clash = ofKind(facts, 'clash').find((c) => c.causes.includes(head.no));
  assert.ok(clash, 'a forced Clash follows');
  assert.equal(clash.templateId, 'clash.pranked');
  assert.equal(clash.a, hothead);
  assert.equal(clash.b, target);
  assert.equal(clash.trigger, 'forced');
  assert.ok(clash.blame.some((b) => b.meddleId === head.meddleId && b.hops === 1));
});

test('a surprise Dare lands as a real Dare that fits him; a surprise Prank picks its own victim', () => {
  const { state, target } = planted({ dareKey: 'surprise' });
  const fitting = new Set(daresFor(content, state.captains[target]!));
  const kinds = new Set<string>();
  for (let seed = 1; seed <= 200; seed++) {
    const { head } = land(state, seed);
    assert.ok(fitting.has(head.dareKey), head.dareKey);
    const def = content.banks.dares[head.dareKey]!;
    kinds.add(def.kind);
    if (def.kind === 'prank') {
      assert.ok(head.victim && head.victim !== target && state.captains[head.victim]!.roster === 'active');
    } else {
      assert.equal(head.victim, undefined);
    }
  }
  assert.deepEqual([...kinds].sort(), ['prank', 'stunt']);
});

test('a Dare on a dead target is held until he Returns; a dead Prank victim holds nothing (data-model decision 16)', () => {
  const dead = (s: WorldState, id: CaptainId): WorldState => ({
    ...s,
    captains: { ...s.captains, [id]: { ...s.captains[id]!, roster: 'dead', returnsAt: addMinutes(s.world.now, 600) } },
  });
  const stunt = planted({ dareKey: 'stunt.torches' }, (s, t) => dead(s, t));
  const r = simulate(stunt.state, [], 3);
  assert.equal(ofKind(r.facts, 'dare').length, 0, 'nothing lands');
  assert.deepEqual(r.stateDiff.meddles, [{ id: stunt.intent.id, status: 'held', heldOn: stunt.target }]);

  const s = setup();
  const prank = planted({ dareKey: 'prank.frog-helmet', victim: s.victim }, (st) => dead(st, s.victim));
  const p = simulate(prank.state, [], 3);
  const [head] = ofKind(p.facts, 'dare');
  assert.ok(head, 'only a dead target holds a Meddle: the Prank lands');
  assert.equal(head.victim, s.victim);
  assert.deepEqual(p.stateDiff.meddles, [{ id: prank.intent.id, status: 'landed', landedFact: head.no }]);
});

test('a Dare that plays on a Fear he is known for is a Callback: 3 more comedy weight (D50)', () => {
  const onFear = planted({ dareKey: 'stunt.moat-swim' }, (s, t) => plain(s, t, { fears: [{ fear: 'Water', added: false, since: s.world.now }] }));
  const offFear = planted({ dareKey: 'stunt.moat-swim' });
  for (const outcome of ['pulled_off', 'refused'] as const) {
    const a = landWith(onFear.state, outcome);
    const b = landWith(offFear.state, outcome);
    assert.equal(a.head.playsOnFear, true);
    assert.equal(b.head.playsOnFear, false);
    assert.deepEqual(a.head.blame.map((e) => [e.playerId, e.hops]), [[P1, 0]], 'a Callback adds no Blame');
    assert.equal(a.head.comedyWeight, b.head.comedyWeight! + 3, outcome);
  }
});
