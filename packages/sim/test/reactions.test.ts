// #30 Reaction chains (D47): reactions chain up to 3 deep inside a tick; the next link goes onto a 5–30
// minute Fuse and carries on from there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content as shipped, type Content, type TemplateDef } from '@orc/content';
import { applyDiff, simulate, type Fact, type WorldState } from '@orc/sim';
import { addMinutes, freshWorld } from './support.ts';

/** A bundle whose one ambient incident always sets off a reaction, which always sets off another. */
function loopingContent(): Content {
  const c = structuredClone(shipped);
  const lines: TemplateDef['lines'] = ['{a} and {b}.', '{a} with {b}.', '{b} and {a}.'];
  c.templates = [
    ...c.templates.filter((t) => t.kind !== 'incident'),
    { id: 'test.root', kind: 'incident', trigger: 'ambient', roles: [{ name: 'a' }, { name: 'b' }], outcomes: [{ key: 'loop', weight: 1 }], lines, baseWeight: 1 },
    {
      id: 'test.again',
      kind: 'incident',
      trigger: 'reaction',
      after: { kind: 'incident', outcomes: ['loop'], chance: 1 },
      roles: [{ name: 'a', from: 'b' }, { name: 'b', from: 'a' }],
      outcomes: [{ key: 'loop', weight: 1 }],
      lines,
      baseWeight: 1,
    },
  ];
  return c;
}

/** A calm world (no Grudges, so no Clashes) on the looping bundle, and a tick seed that rolls the ambient. */
function calm(): { state: WorldState; seed: number } {
  const base = freshWorld({ content: loopingContent(), watched: true });
  const state: WorldState = { ...base, affinity: {}, grudgeTags: [], world: { ...base.world, tickSeq: 1, now: addMinutes(base.world.now, 1) } };
  for (let seed = 1; ; seed++) {
    if (simulate(state, [], seed).facts.length > 0) return { state, seed };
  }
}

const reactionsIn = (facts: Fact[]) => facts.filter((f) => f.kind === 'incident' && f.trigger === 'reaction');

test('reactions never chain past 3 deep in one tick; the 4th goes onto a 5–30 minute Fuse', () => {
  const { state, seed } = calm();
  const { facts, stateDiff } = simulate(state, [], seed);
  const [root, ...rest] = facts;
  assert.equal(root!.kind === 'incident' && root!.trigger, 'ambient');
  const chain = reactionsIn(rest);
  assert.equal(chain.length, 3, 'three links in this tick');
  assert.equal(facts.length, 4);

  // Each link requires the one before it, and heads its own story.
  let parent = root!;
  for (const r of chain) {
    assert.deepEqual(r.causes, [parent.no]);
    assert.equal(r.storyNo, r.no);
    assert.equal(r.templateId, 'test.again');
    assert.equal(r.tier, 'templated');
    parent = r;
  }
  // The 4th is fused, not fired.
  assert.equal(stateDiff.fuses.add.length, 1);
  const fuse = stateDiff.fuses.add[0]!;
  assert.equal(fuse.meddleId, undefined);
  assert.equal(fuse.reaction?.templateId, 'test.again');
  assert.deepEqual(fuse.reaction?.parent, { fact: parent.no, blame: [] });
  const last = parent.kind === 'incident' ? parent.roles : {};
  assert.deepEqual(fuse.reaction?.cast, { a: last.b, b: last.a }, 'cast from its parent, as the Template says');
  const minutes = (Date.parse(fuse.dueAt) - Date.parse(state.world.now)) / 60_000;
  assert.ok(Number.isInteger(minutes) && minutes >= 5 && minutes <= 30, `${minutes} min`);

  // When it comes due it fires first, as the first link of that tick's chain: then 2 more, then a Fuse again.
  const next = applyDiff(state, stateDiff);
  const later: WorldState = { ...next, world: { ...next.world, tickSeq: 2, prevTickAt: next.world.now, now: fuse.dueAt } };
  const after = simulate(later, [], 7);
  const resumed = after.facts[0]!;
  assert.deepEqual(resumed.causes, [parent.no], 'the fused link picks up where the chain left off');
  const descendants = new Set([resumed.no]);
  for (const f of after.facts) if (f.causes.some((c) => descendants.has(c))) descendants.add(f.no);
  assert.equal(descendants.size, 3, 'up to 3 deep again');
  assert.deepEqual(after.stateDiff.fuses.remove, [fuse.no]);
  assert.ok(after.stateDiff.fuses.add.some((f) => f.reaction && descendants.has(f.reaction.parent.fact)));
});

test("a fused reaction whose cast has left the active roster quietly doesn't happen", () => {
  const { state, seed } = calm();
  const { stateDiff } = simulate(state, [], seed);
  const fuse = stateDiff.fuses.add[0]!;
  const next = applyDiff(state, stateDiff);
  const gone = fuse.reaction!.cast.a!;
  const benched: WorldState = {
    ...next,
    captains: { ...next.captains, [gone]: { ...next.captains[gone]!, roster: 'reserve' } },
    world: { ...next.world, tickSeq: 2, now: fuse.dueAt },
  };
  const after = simulate(benched, [], 7);
  assert.ok(!after.facts.some((f) => f.causes.includes(fuse.reaction!.parent.fact)));
  assert.deepEqual(after.stateDiff.fuses.remove, [fuse.no]);
});
