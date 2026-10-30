import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content } from '@orc/content';
import { simulate, tickSeed } from '@orc/sim';
import { freshWorld, SEEDS, step } from './support.ts';

function ambientRate(watched: boolean, ticks: number): number {
  const state = freshWorld({ watched });
  let fired = 0;
  for (let seq = 1; seq <= ticks; seq++) {
    const { facts } = simulate({ ...state, world: { ...state.world, tickSeq: seq } }, [], tickSeed(99, seq));
    if (facts.some((f) => f.kind === 'incident' && f.trigger === 'ambient')) fired++;
  }
  return fired / ticks;
}

test('ambient incidents fire about 1 tick in 3 while watched', () => {
  const rate = ambientRate(true, Math.max(3000, SEEDS * 200));
  assert.ok(Math.abs(rate - 1 / 3) < 0.03, `rate ${rate}`);
});

test('ambient incidents fire about 1 tick in 10 while unwatched', () => {
  const rate = ambientRate(false, Math.max(3000, SEEDS * 200));
  assert.ok(Math.abs(rate - 1 / 10) < 0.02, `rate ${rate}`);
});

test('an ambient incident is a templated story head naming distinct active Captains', () => {
  let state = freshWorld({ watched: true });
  const names = new Map(content.cast.map((c) => [c.id, c.name]));
  let seen = 0;
  for (let i = 0; i < 200; i++) {
    const before = state.world.nextNo;
    const r = step(state);
    // Clashes (the seeded Grudges) and reactions come too; this is about the ambient roll.
    for (const f of r.facts) {
      if (f.kind !== 'incident' || f.trigger !== 'ambient') continue;
      seen++;
      // Returns and healed bandages come earlier in the tick, so they may take the first numbers.
      if (!r.facts.some((x) => x.no < f.no)) assert.equal(f.no, before, 'Fact numbers come from nextNo');
      assert.equal(f.storyNo, f.no, 'an incident heads its own story');
      assert.equal(f.tier, 'templated');
      const template = content.templates.find((t) => t.id === f.templateId);
      assert.ok(template, `unknown template ${f.templateId}`);
      assert.equal(new Set(f.cast).size, f.cast.length, 'cast is distinct');
      for (const id of f.cast) {
        // Active when cast: still active after the tick, unless something in it killed him.
        const died = r.facts.some((x) => x.kind === 'death' && x.captainId === id);
        assert.equal(r.state.captains[id]?.roster, died ? 'dead' : 'active');
        assert.ok(f.line.includes(names.get(id)!), `line "${f.line}" names ${id}`);
      }
      assert.doesNotMatch(f.line, /[{}]/, 'no placeholder left in the line');
    }
    // Grudge tags and Trophies share the counter, so it can run further than the Facts.
    assert.ok(r.state.world.nextNo >= before + r.facts.length, 'nextNo advances past every Fact');
    assert.ok(r.facts.every((f) => f.no >= before && f.no < r.state.world.nextNo));
    state = r.state;
  }
  assert.ok(seen > 20, `only ${seen} incidents`);
});
