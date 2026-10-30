// #34 Infamy, the Warlord and Legendary (D42, D43, D45): Infamy comes only from stupidity, the most
// infamous orc of the week takes the throne, and 150 lifetime Infamy makes a Captain Legendary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content, type Content } from '@orc/content';
import { applyDiff, simulate, type CaptainId, type Fact, type WorldState } from '@orc/sim';
import { activeIds, addMinutes, freshWorld } from './support.ts';

type Of<K extends Fact['kind']> = Extract<Fact, { kind: K }>;
const ofKind = <K extends Fact['kind']>(facts: Fact[], kind: K) => facts.filter((f): f is Of<K> => f.kind === kind);
const gained = (story: Fact[], id: CaptainId) =>
  story.reduce((n, f) => n + f.infamy.filter((g) => g.captainId === id).reduce((s, g) => s + g.amount, 0), 0);

/** Four feuding pairs of plain Captains (no Trait bends a Clash), none of them the Warlord. */
function arena(patch: (s: WorldState, ids: CaptainId[]) => WorldState = (s) => s): WorldState {
  const base = freshWorld({ seed: 5 });
  const ids = activeIds(base).filter((id) => id !== base.world.warlordId).slice(0, 8);
  const captains = { ...base.captains };
  const affinity: WorldState['affinity'] = {};
  for (let i = 0; i < 8; i += 2) {
    captains[ids[i]!] = { ...captains[ids[i]!]!, power: 5, traits: ['Snob', 'Hoarder'] };
    captains[ids[i + 1]!] = { ...captains[ids[i + 1]!]!, power: 5, traits: ['Snob', 'Hoarder'] };
    affinity[`${ids[i]}>${ids[i + 1]}`] = -80;
  }
  const state: WorldState = {
    ...base,
    captains,
    affinity,
    grudgeTags: [],
    world: { ...base.world, tickSeq: 1, now: addMinutes(base.world.now, 5) },
  };
  return patch(state, ids);
}

/** Every Clash story the state makes over `n` tick seeds. */
function clashStories(state: WorldState, n: number): { head: Of<'clash'>; story: Fact[]; facts: Fact[] }[] {
  const out: { head: Of<'clash'>; story: Fact[]; facts: Fact[] }[] = [];
  for (let seed = 1; seed <= n; seed++) {
    const { facts } = simulate(state, [], seed);
    for (const head of ofKind(facts, 'clash')) out.push({ head, story: facts.filter((f) => f.storyNo === head.no), facts });
  }
  return out;
}

test('a Clash win gives 0 Infamy; losing it is stupid, and fleeing or a wrong saviour is worse', () => {
  const stories = clashStories(arena(), 300);
  assert.ok(stories.length > 30, `${stories.length} Clashes`);
  for (const { head, story } of stories) {
    assert.equal(gained(story, head.winner), 0, `Clash ${head.no}: the winner gains nothing`);
    const died = ofKind(story, 'death').length > 0;
    const loss = gained(story, head.loser) - (died ? 20 : 0) - 3 * ofKind(story, 'humiliation').length;
    const expected = head.saviour ? 18 : head.outcome === 'fled' ? 8 : 6;
    assert.equal(loss, expected, `Clash ${head.no} (${head.outcome}${head.saviour ? ', saviour' : ''}): the loser's Infamy`);
    if (head.saviour) assert.equal(gained(story, head.saviour), 3, 'the wrong saviour is mocked too');
  }
});

/** A bundle whose only ambient incident kills its one Captain, pinned to `victim`. No reactions. */
function deadly(victim: CaptainId): Content {
  const c = structuredClone(content);
  c.templates = [
    ...c.templates.filter((t) => t.trigger !== 'ambient' && t.trigger !== 'reaction'),
    {
      id: 'test.deadly',
      kind: 'incident',
      trigger: 'ambient',
      roles: [{ name: 'a', captain: victim }],
      outcomes: [{ key: 'dead', weight: 1, death: { role: 'a', tag: 'fell' } }],
      lines: ['{a} tripped.', '{a} slipped.', '{a} fell over.'],
      baseWeight: 1,
    },
  ];
  return c;
}

/** A calm world (no Grudges) one tick on, where an accident kills the Warlord; and a tick seed that rolls it. */
function warlordDies(patch: (s: WorldState) => WorldState = (s) => s): { state: WorldState; seed: number; warlord: CaptainId } {
  const warlord = freshWorld().world.warlordId!;
  const base = freshWorld({ watched: true, content: deadly(warlord) });
  const state = patch({ ...base, affinity: {}, grudgeTags: [], world: { ...base.world, tickSeq: 1, now: addMinutes(base.world.now, 5) } });
  for (let seed = 1; ; seed++) {
    if (simulate(state, [], seed).facts.length > 0) return { state, seed, warlord };
  }
}

test('the Warlord falls when he dies, and the most infamous orc of the week is crowned, taking +20 for the throne', () => {
  const { state, seed, warlord } = warlordDies();
  const { facts, stateDiff } = simulate(state, [], seed);
  const [death] = ofKind(facts, 'death');
  const [fell] = ofKind(facts, 'warlord_fell');
  assert.ok(death && fell, 'he dies and falls');
  assert.equal(death.captainId, warlord);
  assert.equal(fell.captainId, warlord);
  assert.equal(fell.why, 'death');
  assert.equal(fell.storyNo, death.storyNo, 'the fall is part of the story that killed him');
  assert.deepEqual(fell.causes, [death.no]);

  const [crowned] = ofKind(facts, 'crowned');
  assert.ok(crowned, 'someone takes the throne');
  assert.equal(crowned.storyNo, crowned.no, 'a crowning is a story head');
  assert.equal(crowned.previous, warlord);
  assert.deepEqual(crowned.causes, [fell.no], 'it requires the fall');
  assert.equal(crowned.templateId, 'roster.crowned');
  const king = crowned.intro.captainId;
  assert.notEqual(king, warlord);
  assert.equal(stateDiff.world.warlordId, king);
  assert.deepEqual(crowned.infamy, [{ captainId: king, amount: 20 }], 'the throne earns +20');
  assert.ok(crowned.line.includes(content.cast.find((c) => c.id === king)!.name));
});

test('succession: the most Infamy in the last 7 days, then Power, then lifetime Infamy, then slug', () => {
  const sample = warlordDies().state;
  const now = sample.world.now;
  const [x, y, z] = activeIds(sample, (id) => id !== sample.world.warlordId) as [CaptainId, CaptainId, CaptainId];
  let fact = 500;
  const gain = (id: CaptainId, amount: number, daysAgo = 1) => ({ captainId: id, fact: fact++, at: addMinutes(now, -daysAgo * 1440), amount });
  /** Who is crowned when everyone else is level (Power 5, no Infamy), but for these. */
  const crowned = (patch: Record<CaptainId, { power?: number; infamy?: number }>, infamy7d: WorldState['infamy7d']): CaptainId => {
    const { state, seed } = warlordDies((s) => {
      const captains = { ...s.captains };
      for (const id of activeIds(s, (c) => c !== s.world.warlordId)) captains[id] = { ...captains[id]!, power: 5, infamy: 0, ...patch[id] };
      return { ...s, captains, infamy7d };
    });
    return ofKind(simulate(state, [], seed).facts, 'crowned')[0]!.intro.captainId;
  };

  assert.equal(crowned({ [y]: { power: 10, infamy: 140 } }, [gain(x, 12, 6.9), gain(y, 11, 2), gain(z, 90, 7.1)]), x, 'the week beats Power and lifetime; older gains drop out');
  assert.equal(crowned({ [z]: { power: 6 }, [y]: { infamy: 100 } }, [gain(x, 10), gain(y, 10), gain(z, 10)]), z, 'level on the week: Power');
  assert.equal(crowned({ [y]: { infamy: 3 } }, [gain(x, 10), gain(y, 10), gain(z, 10)]), y, 'level on Power too: lifetime Infamy');
  assert.equal(crowned({}, [gain(z, 10), gain(y, 10), gain(x, 10)]), x, 'level on everything: slug');
});

test('the Warlord falls on any Clash loss, and sits out the succession it sets off', () => {
  const base = freshWorld({ seed: 5 });
  const warlord = base.world.warlordId!;
  const rival = activeIds(base, (id) => id !== warlord)[0]!;
  // He is the weaker one, and the week's most infamous orc: only his fall can keep him off the throne.
  const captains = {
    ...base.captains,
    [warlord]: { ...base.captains[warlord]!, power: 3, traits: ['Snob', 'Hoarder'] as [string, string] },
    [rival]: { ...base.captains[rival]!, power: 7, traits: ['Snob', 'Hoarder'] as [string, string] },
  };
  const state: WorldState = {
    ...base,
    captains,
    affinity: { [`${warlord}>${rival}`]: -80 },
    grudgeTags: [],
    infamy7d: [{ captainId: warlord, fact: 1, at: base.world.now, amount: 100 }],
    world: { ...base.world, tickSeq: 1, now: addMinutes(base.world.now, 5) },
  };
  let lost = 0;
  let won = 0;
  for (const { head, story, facts } of clashStories(state, 2000)) {
    const [fell] = ofKind(story, 'warlord_fell');
    if (head.winner === warlord) {
      won++;
      assert.equal(fell, undefined, 'a win keeps the throne');
      assert.equal(ofKind(facts, 'crowned').length, 0);
      continue;
    }
    lost++;
    assert.ok(fell, `Clash ${head.no}: losing costs him the throne`);
    assert.equal(fell.why, 'clash_loss');
    assert.deepEqual(fell.causes, [head.no]);
    assert.equal(ofKind(story, 'warlord_fell').length, 1, 'he falls once, even if he dies of it too');
    const [crowned] = ofKind(facts, 'crowned');
    assert.ok(crowned && crowned.previous === warlord);
    assert.notEqual(crowned.intro.captainId, warlord);
  }
  assert.ok(lost > 0 && won > 0, `${lost} lost, ${won} won`);
});

test('crossing 150 lifetime Infamy writes one legendary Fact, pointing at the story head that did it', () => {
  const { state, seed, warlord } = warlordDies((s) => {
    const w = s.world.warlordId!;
    return { ...s, captains: { ...s.captains, [w]: { ...s.captains[w]!, infamy: 140 } } };
  });
  const { facts, stateDiff } = simulate(state, [], seed);
  const [legendary] = ofKind(facts, 'legendary');
  const head = facts[0]!;
  assert.ok(legendary, 'his death takes him past 150');
  assert.equal(legendary.captainId, warlord);
  assert.equal(legendary.deed, head.no, 'the deed is the story head');
  assert.equal(legendary.storyNo, head.no);
  assert.deepEqual(legendary.causes, [head.no]);
  assert.equal(ofKind(facts, 'legendary').length, 1);
  const patch = stateDiff.captains.find((c) => c.id === warlord)!;
  assert.equal(patch.legendaryFact, head.no);
  assert.equal(patch.infamy, 160);

  // Legendary is for good: more Infamy never makes another deed.
  const again = warlordDies((s) => {
    const w = s.world.warlordId!;
    return { ...s, captains: { ...s.captains, [w]: { ...s.captains[w]!, infamy: 160, legendaryFact: 42 } } };
  });
  const later = simulate(again.state, [], again.seed);
  assert.equal(ofKind(later.facts, 'legendary').length, 0);
  assert.equal(later.stateDiff.captains.find((c) => c.id === warlord)!.legendaryFact, undefined);
});

test('a Legendary Captain is introduced with his stamp', () => {
  // The Warlord dies; a Legendary orc with the most Infamy this week takes the throne.
  const { state, seed } = warlordDies((s) => {
    const heir = activeIds(s, (id) => id !== s.world.warlordId)[3]!;
    return {
      ...s,
      captains: { ...s.captains, [heir]: { ...s.captains[heir]!, infamy: 200, legendaryFact: 7 } },
      infamy7d: [{ captainId: heir, fact: 7, at: s.world.now, amount: 30 }],
    };
  });
  const [crowned] = ofKind(simulate(state, [], seed).facts, 'crowned');
  assert.equal(crowned!.intro.legendary, true);
});

test('the 7-day window moves on in memory as the tick reloads it: old gains drop out, this tick’s join', () => {
  const { state, seed } = warlordDies((s) => ({
    ...s,
    infamy7d: [
      { captainId: 'krug', fact: 3, at: addMinutes(s.world.now, -7 * 1440), amount: 9 },
      { captainId: 'krug', fact: 4, at: addMinutes(s.world.now, -7 * 1440 + 1), amount: 4 },
    ],
  }));
  const { facts, stateDiff } = simulate(state, [], seed);
  const next = applyDiff(state, stateDiff);
  const mine = facts.flatMap((f) => f.infamy.map((g) => ({ captainId: g.captainId, fact: f.no, at: f.at, amount: g.amount })));
  assert.ok(mine.length >= 2, 'the death and the throne');
  const expected = [{ captainId: 'krug', fact: 4, at: addMinutes(state.world.now, -7 * 1440 + 1), amount: 4 }, ...mine].sort(
    (a, b) => a.fact - b.fact || (a.captainId < b.captainId ? -1 : 1),
  );
  assert.deepEqual(next.infamy7d, expected);
});
