// #32 Death, Return and the roster (D40, D41, D44): Captains die, come back Humiliated, and the active
// roster stays at 12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content as shipped, KRUG, type Content, type TemplateDef } from '@orc/content';
import { applyDiff, simulate, type CaptainId, type Fact, type WorldState } from '@orc/sim';
import { activeIds, addMinutes, freshWorld } from './support.ts';

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
