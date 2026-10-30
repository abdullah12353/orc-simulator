// #32 Death, Return and the roster (D40, D41, D44): Captains die, come back Humiliated, and the active
// roster stays at 12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content as shipped, KRUG, type Content, type TemplateDef } from '@orc/content';
import { applyDiff, simulate, type CaptainId, type Fact, type WorldState } from '@orc/sim';
import { activeIds, addMinutes, freshWorld, rumour, SEEDS } from './support.ts';

type Of<K extends Fact['kind']> = Extract<Fact, { kind: K }>;
const ofKind = <K extends Fact['kind']>(facts: Fact[], kind: K) => facts.filter((f): f is Of<K> => f.kind === kind);

/** A bundle whose only ambient incident always kills its one Captain, tagged `tag`. */
function deadlyContent(tag: 'drowned' | 'fell' | 'beaten' = 'drowned'): Content {
  const c = structuredClone(shipped);
  const lines: TemplateDef['lines'] = ['{a} tripped.', '{a} slipped.', '{a} fell over.'];
  c.templates = [
    ...c.templates.filter((t) => t.trigger !== 'ambient' && t.trigger !== 'reaction'),
    {
      id: 'test.deadly',
      kind: 'incident',
      trigger: 'ambient',
      roles: [{ name: 'a' }],
      outcomes: [{ key: 'dead', weight: 1, death: { role: 'a', tag } }],
      lines,
      baseWeight: 1,
    },
  ];
  return c;
}

/** A calm world (no Grudges) on `c`, one tick on, and the first tick seed that rolls the ambient. */
function calm(c: Content, patch: (s: WorldState) => WorldState = (s) => s): { state: WorldState; seed: number } {
  const base = freshWorld({ content: c, watched: true });
  const state = patch({ ...base, affinity: {}, grudgeTags: [], world: { ...base.world, tickSeq: 1, now: addMinutes(base.world.now, 1) } });
  for (let seed = 1; ; seed++) {
    if (simulate(state, [], seed).facts.length > 0) return { state, seed };
  }
}

test('an accident kills: he is dead until 2–12 h later, the cause is tagged, and a reserve Captain steps in', () => {
  const { state, seed } = calm(deadlyContent('drowned'));
  const { facts, stateDiff } = simulate(state, [], seed);
  const [head] = facts;
  const [death] = ofKind(facts, 'death');
  assert.ok(head && death, 'an accident and a death');
  const victim = death.captainId;
  assert.equal(death.storyNo, head.no, 'the death is a consequence of the accident');
  assert.deepEqual(death.causes, [head.no]);
  assert.equal(death.causeTag, 'drowned');
  const hours = (Date.parse(death.returnsAt) - Date.parse(state.world.now)) / 3_600_000;
  assert.ok(hours >= 2 && hours <= 12, `${hours} h`);
  assert.ok(head.line.includes(shipped.cast.find((c) => c.id === victim)!.name), 'the story says who died');

  const next = applyDiff(state, stateDiff);
  const dead = next.captains[victim]!;
  assert.equal(dead.roster, 'dead');
  assert.equal(dead.returnsAt, death.returnsAt);
  assert.deepEqual(dead.death, { cause: { fact: death.no, blame: [] }, causeTag: 'drowned' });
  assert.equal(next.world.deathsToday, 1);

  const [stepped] = ofKind(facts, 'stepped_in');
  assert.ok(stepped, 'someone steps in');
  assert.equal(stepped.storyNo, stepped.no, 'stepping in is a story head');
  assert.equal(stepped.replacing, victim);
  assert.deepEqual(stepped.causes, [death.no]);
  assert.equal(state.captains[stepped.intro.captainId]!.roster, 'reserve', 'from the reserve');
  assert.equal(next.captains[stepped.intro.captainId]!.roster, 'active');
  assert.equal(stepped.templateId, 'roster.stepped-in');
  assert.equal(activeIds(next).length, 12);
});

test('a 4th death in one London day becomes death_averted plus one Humiliation', () => {
  const { state, seed } = calm(deadlyContent('fell'), (s) => ({ ...s, world: { ...s.world, deathsToday: 3 } }));
  const { facts, stateDiff } = simulate(state, [], seed);
  assert.equal(ofKind(facts, 'death').length, 0);
  const [averted] = ofKind(facts, 'death_averted');
  assert.ok(averted);
  assert.equal(averted.why, 'daily_cap');
  const humiliations = ofKind(facts, 'humiliation');
  assert.equal(humiliations.length, 1);
  assert.equal(humiliations[0]!.captainId, averted.captainId);
  assert.ok(shipped.banks.humiliations[humiliations[0]!.key]!.causes.includes('fell'), 'fits the cause');
  assert.equal(ofKind(facts, 'stepped_in').length, 0);

  const next = applyDiff(state, stateDiff);
  assert.equal(next.captains[averted.captainId]!.roster, 'active');
  assert.equal(next.world.deathsToday, 3);
  assert.equal(next.humiliations.filter((h) => h.captainId === averted.captainId).length, 1);
});

test('a death inside his hour of grace is averted', () => {
  const { state, seed } = calm(deadlyContent('beaten'), (s) => {
    const captains = { ...s.captains };
    for (const id of activeIds(s)) captains[id] = { ...captains[id]!, graceUntil: addMinutes(s.world.now, 30) };
    return { ...s, captains };
  });
  const { facts } = simulate(state, [], seed);
  assert.equal(ofKind(facts, 'death').length, 0);
  assert.equal(ofKind(facts, 'death_averted')[0]?.why, 'grace');
  assert.equal(ofKind(facts, 'humiliation').length, 1);

  // Once the hour is up, the same accident kills.
  const later: WorldState = { ...state, world: { ...state.world, now: addMinutes(state.world.now, 31) } };
  let lateFacts: Fact[] = [];
  for (let s = 1; lateFacts.length === 0; s++) lateFacts = simulate(later, [], s).facts;
  assert.equal(ofKind(lateFacts, 'death').length, 1);
  assert.equal(ofKind(lateFacts, 'death_averted').length, 0);
});

const P1 = '11111111-1111-4111-8111-111111111111';
const quiet = (): Content => {
  // No ambient incidents and no reactions: only what the roster itself does.
  const c = structuredClone(shipped);
  c.templates = c.templates.filter((t) => t.trigger !== 'ambient' && t.trigger !== 'reaction');
  return c;
};

/**
 * A calm world where `victim` died of `tag` (as Fact 900) and is due back now, a reserve Captain having
 * taken his place. Everyone else gained 10 Infamy in the last 7 days, except `lowest` (5), who should be the one benched.
 */
function dueBack(tag: 'beaten' | 'drowned' | 'fell', seed = 1): { state: WorldState; victim: CaptainId; lowest: CaptainId } {
  const base = freshWorld({ content: quiet(), seed, players: [P1] });
  const active = activeIds(base);
  const victim = active.find((id) => id !== KRUG && id !== base.world.warlordId)!;
  const lowest = active.find((id) => id !== KRUG && id !== base.world.warlordId && id !== victim)!;
  const stand = Object.keys(base.captains).find((id) => base.captains[id]!.roster === 'reserve')!;
  const captains = { ...base.captains };
  const now = addMinutes(base.world.now, 5);
  // Benching goes by Infamy in the last 7 days (#34): lifetime Infamy and older gains don't count.
  const decoy = active.find((id) => id !== KRUG && id !== base.world.warlordId && id !== victim && id !== lowest)!;
  for (const id of Object.keys(captains)) captains[id] = { ...captains[id]!, infamy: id === decoy ? 1 : 50 };
  const infamy7d: WorldState['infamy7d'] = [];
  for (const [i, id] of Object.keys(captains).sort().entries()) {
    const amount = id === KRUG || id === base.world.warlordId ? 0 : id === lowest ? 5 : 10;
    if (amount > 0) infamy7d.push({ captainId: id, fact: 800 + i, at: addMinutes(now, -24 * 60), amount });
  }
  infamy7d.unshift({ captainId: lowest, fact: 700, at: addMinutes(now, -8 * 24 * 60), amount: 100 });
  captains[victim] = { ...captains[victim]!, roster: 'dead', returnsAt: now, death: { cause: { fact: 900, blame: [] }, causeTag: tag } };
  captains[stand] = { ...captains[stand]!, roster: 'active' };
  const state: WorldState = {
    ...base,
    captains,
    infamy7d,
    affinity: {},
    grudgeTags: [],
    world: { ...base.world, tickSeq: 1, now, nextNo: 1000 },
  };
  return { state, victim, lowest };
}

test('every Return is a story head carrying exactly one Humiliation that fits how he died, and an hour of grace', () => {
  const cats = new Set<string>();
  for (const tag of ['beaten', 'drowned', 'fell'] as const) {
    for (let seed = 1; seed <= Math.max(30, SEEDS * 3); seed++) {
      const { state, victim } = dueBack(tag, seed);
      const { facts, stateDiff } = simulate(state, [], seed);
      const [ret] = ofKind(facts, 'return');
      assert.ok(ret, `${tag}/${seed}: he Returns`);
      assert.equal(ret.storyNo, ret.no);
      assert.equal(ret.intro.captainId, victim);
      assert.deepEqual(ret.causes, [900], 'his death is what the Return required');
      assert.equal(ret.templateId, 'roster.return');
      assert.equal(ret.graceUntil, addMinutes(state.world.now, 60));
      const story = facts.filter((f) => f.storyNo === ret.no);
      const hum = ofKind(story, 'humiliation');
      assert.equal(hum.length, 1, `${tag}/${seed}: exactly one Humiliation`);
      const def = shipped.banks.humiliations[hum[0]!.key]!;
      assert.equal(def.cat, hum[0]!.cat);
      assert.ok(def.causes.includes(tag), `${hum[0]!.key} fits ${tag}`);
      cats.add(def.cat);

      const next = applyDiff(state, stateDiff);
      const back = next.captains[victim]!;
      assert.equal(back.roster, 'active');
      assert.equal(back.death, null);
      assert.equal(back.returnsAt, null);
      assert.equal(back.graceUntil, ret.graceUntil);
      assert.equal(back.power, state.captains[victim]!.power, 'Humiliations never touch Power');
      assert.deepEqual(next.humiliations.filter((h) => h.captainId === victim).map((h) => h.key), [hum[0]!.key]);
      if (def.cat === 'disguise') {
        assert.notEqual(back.aliasIdx, null);
        assert.equal(ret.intro.aliasIdx, back.aliasIdx, 'he is introduced under his alias');
      }
      if (def.cat === 'epithet') assert.equal(back.epithet, def.epithet);
      if (def.cat === 'epithet') assert.equal(ret.intro.epithet, def.epithet);
      if (def.cat === 'fear') assert.ok(back.fears.some((f) => f.fear === def.fear && f.added));
      if (def.cat === 'bandage') assert.equal(hum[0]!.expiresAt, addMinutes(state.world.now, 48 * 60));
    }
  }
  assert.deepEqual([...cats].sort(), ['bandage', 'disguise', 'epithet', 'fear', 'lost_bit'], 'all five categories turn up');
});

test('a Returner benches the active Captain with the least Infamy in the last 7 days, never Krúg or the Warlord', () => {
  const { state, victim, lowest } = dueBack('beaten');
  const { facts, stateDiff } = simulate(state, [], 3);
  const [ret] = ofKind(facts, 'return');
  const [benched] = ofKind(facts, 'benched');
  assert.ok(ret && benched);
  assert.equal(benched.captainId, lowest, 'Krúg and the Warlord have less, but are never benched; lifetime and old Infamy do not count');
  assert.equal(benched.storyNo, ret.no);
  assert.deepEqual(benched.causes, [ret.no]);
  const next = applyDiff(state, stateDiff);
  assert.equal(next.captains[lowest]!.roster, 'reserve');
  assert.equal(next.captains[victim]!.roster, 'active');
  assert.equal(activeIds(next).length, 12);
});

test('a Meddle on a dead target is held without a Fact, then re-fused 10–90 min after his Return; a dead source does not hold', () => {
  const { state: start, victim } = dueBack('drowned');
  const [other, third] = activeIds(start).filter((id) => id !== victim);
  // Not back yet: an hour early.
  const early: WorldState = {
    ...start,
    captains: { ...start.captains, [victim]: { ...start.captains[victim]!, returnsAt: addMinutes(start.world.now, 60) } },
  };
  const onDead = rumour(early, P1, { source: other!, target: victim });
  const fromDead = rumour(early, P1, { source: victim, target: third! });
  const planted = simulate(early, [onDead, fromDead], 1);
  let state = applyDiff(early, planted.stateDiff);
  // Both Fuses come due.
  state = { ...state, fuses: state.fuses.map((f) => ({ ...f, dueAt: addMinutes(early.world.now, 30) })) };
  state = { ...state, world: { ...state.world, tickSeq: 2, prevTickAt: state.world.now, now: addMinutes(early.world.now, 30) } };
  const fired = simulate(state, [], 2);
  assert.deepEqual(fired.stateDiff.meddles.find((m) => m.id === onDead.id), { id: onDead.id, status: 'held', heldOn: victim });
  assert.ok(ofKind(fired.facts, 'rumour').some((f) => f.meddleId === fromDead.id), 'a dead source does not hold a Rumour');
  for (const f of fired.facts) assert.ok(!JSON.stringify(f).includes(onDead.id), 'no Fact carries a held Meddle');
  state = applyDiff(state, fired.stateDiff);
  assert.equal(state.meddles[onDead.id]?.status, 'held');

  // He Returns: the held Meddle goes back on a fresh Fuse.
  const back: WorldState = { ...state, world: { ...state.world, tickSeq: 3, prevTickAt: state.world.now, now: addMinutes(state.world.now, 30) } };
  const returned = simulate(back, [], 3);
  assert.equal(ofKind(returned.facts, 'return').length, 1);
  assert.deepEqual(returned.stateDiff.meddles, [{ id: onDead.id, status: 'pending', heldOn: null }]);
  const [fuse] = returned.stateDiff.fuses.add;
  assert.equal(fuse?.meddleId, onDead.id);
  const minutes = (Date.parse(fuse!.dueAt) - Date.parse(back.world.now)) / 60_000;
  assert.ok(Number.isInteger(minutes) && minutes >= 10 && minutes <= 90, `${minutes} min`);
  for (const f of returned.facts) assert.ok(!JSON.stringify(f).includes(onDead.id), 'the Return says nothing about it');
});

/** Steps `state` to `now` with one simulate + applyDiff (tick seed `seed`). */
function at(state: WorldState, now: string, seed = 1) {
  const input: WorldState = { ...state, world: { ...state.world, tickSeq: state.world.tickSeq + 1, prevTickAt: state.world.now, now } };
  const r = simulate(input, [], seed);
  return { facts: r.facts, state: applyDiff(input, r.stateDiff) };
}

test('bandages heal about 2 days after he got them, and not before', () => {
  // Find a Return that bandages him.
  let found: { state: WorldState; victim: CaptainId; key: string; gainedAt: string } | null = null;
  for (let seed = 1; !found; seed++) {
    const { state, victim } = dueBack('beaten', seed);
    const r = at(state, state.world.now, seed);
    const h = r.state.humiliations.find((x) => x.captainId === victim && x.cat === 'bandage');
    if (h) found = { state: r.state, victim, key: h.key, gainedAt: state.world.now };
  }
  const { victim, gainedAt } = found;
  const h = found.state.humiliations.find((x) => x.captainId === victim && x.cat === 'bandage')!;
  assert.equal(h.expiresAt, addMinutes(gainedAt, 48 * 60));

  const before = at(found.state, addMinutes(gainedAt, 48 * 60 - 1));
  assert.ok(before.state.humiliations.some((x) => x.no === h.no), 'still bandaged a minute before');
  assert.equal(ofKind(before.facts, 'humiliation_ended').length, 0);

  const healed = at(before.state, addMinutes(gainedAt, 48 * 60));
  const [ended] = ofKind(healed.facts, 'humiliation_ended');
  assert.ok(ended);
  assert.equal(ended.humiliation, h.no);
  assert.equal(ended.why, 'healed');
  assert.equal(ended.captainId, victim);
  assert.equal(ended.tier, 'silent');
  assert.ok(!healed.state.humiliations.some((x) => x.no === h.no), 'the bandage is gone');
});

/** A world where `id` is disguised (alias 1), with the disguise as Humiliation 950. */
function disguised(c: Content = quiet()): { state: WorldState; id: CaptainId } {
  const base = freshWorld({ content: c, players: [P1] });
  const id = activeIds(base).find((x) => x !== KRUG && x !== base.world.warlordId)!;
  const state: WorldState = {
    ...base,
    affinity: {},
    grudgeTags: [],
    captains: { ...base.captains, [id]: { ...base.captains[id]!, aliasIdx: 1 } },
    humiliations: [
      { no: 950, captainId: id, cat: 'disguise', key: 'disguise.bucket', gained: { fact: 949, blame: [] }, expiresAt: null, ended: false },
    ],
    world: { ...base.world, nextNo: 1000 },
  };
  return { state, id };
}

test('a Rumour about a disguised Captain can Unmask him: its own story, and his disguise ends', () => {
  let unmaskings = 0;
  const n = Math.max(60, SEEDS * 3);
  for (let seed = 1; seed <= n; seed++) {
    const { state, id } = disguised();
    const source = activeIds(state).find((x) => x !== id)!;
    const intent = rumour(state, P1, { source, target: id, firstMeddle: true });
    const t1: WorldState = { ...state, world: { ...state.world, tickSeq: 1, now: addMinutes(state.world.now, 1) } };
    let s = applyDiff(t1, simulate(t1, [intent], seed).stateDiff);
    const due = s.fuses[0]!.dueAt;
    const t2: WorldState = { ...s, world: { ...s.world, tickSeq: 2, prevTickAt: s.world.now, now: due } };
    const r = simulate(t2, [], seed);
    s = applyDiff(t2, r.stateDiff);
    const [rumourHead] = ofKind(r.facts, 'rumour');
    const [unmasked] = ofKind(r.facts, 'unmasked');
    if (!unmasked) {
      assert.ok(s.humiliations.some((h) => h.no === 950), 'still disguised');
      continue;
    }
    unmaskings++;
    assert.equal(unmasked.captainId, id);
    assert.equal(unmasked.by, 'rumour');
    assert.equal(unmasked.storyNo, unmasked.no, 'an Unmasking is a story head');
    assert.equal(unmasked.templateId, 'roster.unmasked');
    assert.ok(unmasked.line.includes(shipped.cast.find((c) => c.id === id)!.aliases[1]), 'names the alias he used');
    assert.deepEqual(unmasked.causes, [rumourHead!.no]);
    assert.deepEqual(unmasked.blame.map((b) => [b.meddleId, b.hops]), [[intent.id, 1]], "the Rumour's Meddle is to blame");
    const [ended] = ofKind(r.facts, 'humiliation_ended');
    assert.deepEqual([ended?.humiliation, ended?.why, ended?.storyNo], [950, 'unmasked', unmasked.no]);
    assert.equal(s.captains[id]!.aliasIdx, null);
    assert.ok(!s.humiliations.some((h) => h.no === 950));
  }
  assert.ok(unmaskings > n * 0.1 && unmaskings < n * 0.6, `${unmaskings} Unmaskings in ${n}`);
});

test('losing a Clash and living can Unmask a disguised Captain; winning never does', () => {
  const { state: base, id } = disguised();
  const foe = activeIds(base).find((x) => x !== id && x !== KRUG)!;
  const state: WorldState = { ...base, affinity: { [`${foe}>${id}`]: -90 }, world: { ...base.world, tickSeq: 1 } };
  let lostAndLived = 0;
  let unmasked = 0;
  for (let seed = 1; seed <= Math.max(3000, SEEDS * 150); seed++) {
    const { facts } = simulate(state, [], seed);
    const clash = ofKind(facts, 'clash')[0];
    if (!clash) continue;
    const exposed = ofKind(facts, 'unmasked');
    if (clash.loser !== id) {
      assert.equal(exposed.length, 0, 'a winner keeps his disguise');
      continue;
    }
    if (ofKind(facts, 'death').some((d) => d.captainId === id)) continue;
    lostAndLived++;
    if (exposed.length === 0) continue;
    unmasked++;
    assert.equal(exposed[0]!.by, 'clash');
    assert.deepEqual(exposed[0]!.causes, [clash.no]);
  }
  assert.ok(lostAndLived > 10, `${lostAndLived} lost and lived`);
  assert.ok(Math.abs(unmasked / lostAndLived - 0.5) < 0.25, `${unmasked} of ${lostAndLived} Unmasked`);
});

test('dying again ends a disguise too', () => {
  const { state: base, id } = disguised(deadlyContent('fell'));
  // Only he can be cast in the deadly accident.
  const captains = { ...base.captains };
  for (const x of activeIds(base)) if (x !== id) captains[x] = { ...captains[x]!, roster: 'reserve' };
  const state: WorldState = { ...base, captains, world: { ...base.world, tickSeq: 1, watched: true } };
  let r: ReturnType<typeof simulate> | null = null;
  for (let seed = 1; !r || r.facts.length === 0; seed++) r = simulate(state, [], seed);
  const [death] = ofKind(r.facts, 'death');
  assert.equal(death?.captainId, id);
  const [ended] = ofKind(r.facts, 'humiliation_ended');
  assert.deepEqual([ended?.humiliation, ended?.why], [950, 'died']);
  const next = applyDiff(state, r.stateDiff);
  assert.equal(next.captains[id]!.aliasIdx, null);
  assert.deepEqual(next.humiliations, []);
});

test('deaths and Humiliations are misfortunes an accuser can blame on a Player', () => {
  const accuser = KRUG; // one of the 6 accusers
  const says = 'Mo-mo';
  const kinds = new Set<string>();
  for (const capped of [false, true]) {
    const base = freshWorld({ content: deadlyContent('drowned'), watched: true });
    // Only Krúg can be cast in the deadly accident.
    const captains = { ...base.captains };
    for (const x of activeIds(base)) if (x !== accuser) captains[x] = { ...captains[x]!, roster: 'reserve' };
    const state: WorldState = {
      ...base,
      captains,
      affinity: {},
      grudgeTags: [],
      players: { [P1]: { gold: 30, meddles: 3, firstMeddleDone: true, renderedFor: [{ accuser, clipKey: 'names/mo.mp3', says }] } },
      world: { ...base.world, tickSeq: 1, deathsToday: capped ? 3 : 0 },
    };
    for (let seed = 1; seed <= 400; seed++) {
      const { facts } = simulate(state, [], seed);
      for (const a of ofKind(facts, 'accusation')) {
        const misfortune = facts.find((f) => a.causes.includes(f.no))!;
        assert.ok(misfortune.kind === 'death' || misfortune.kind === 'humiliation', misfortune.kind);
        kinds.add(misfortune.kind);
      }
    }
  }
  assert.deepEqual([...kinds].sort(), ['death', 'humiliation']);
});

test('a Rumour can be about a Fear he came back with earlier in the same tick', () => {
  // Find a Return that gives him a new Fear.
  for (let seed = 1; ; seed++) {
    const { state, victim } = dueBack('drowned', seed);
    const fear = ofKind(simulate(state, [], seed).facts, 'humiliation').find((h) => h.cat === 'fear');
    if (!fear) continue;
    const def = shipped.banks.humiliations[fear.key]!;
    assert.ok(!state.captains[victim]!.fears.some((f) => f.fear === def.fear), 'a Fear he did not have before');
    const source = activeIds(state).find((id) => id !== victim)!;
    const intent = rumour(state, P1, { source, target: victim, subject: { from: 'fear', key: def.fear! } });
    const { stateDiff } = simulate(state, [intent], seed);
    assert.deepEqual(stateDiff.intents, [{ id: intent.id, status: 'consumed' }], 'the Return happens first, so his new Fear counts');
    return;
  }
});

test('a Legendary Captain is never benched, however quiet his week (D45: he keeps playing)', () => {
  const { state: base, lowest } = dueBack('beaten');
  const state: WorldState = { ...base, captains: { ...base.captains, [lowest]: { ...base.captains[lowest]!, infamy: 160, legendaryFact: 600 } } };
  const { facts, stateDiff } = simulate(state, [], 3);
  const [benched] = ofKind(facts, 'benched');
  assert.ok(benched);
  assert.notEqual(benched.captainId, lowest, 'the Legendary one stays');
  const next = applyDiff(state, stateDiff);
  assert.equal(next.captains[lowest]!.roster, 'active');
  assert.equal(activeIds(next).length, 12);
});
