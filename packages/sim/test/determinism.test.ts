import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, stateHash } from '@orc/sim';
import { freshWorld, run, SEEDS, step } from './support.ts';

test('the same state, intents and seed always give identical Facts and diff', () => {
  const state = freshWorld();
  for (let seed = 1; seed <= SEEDS * 10; seed++) {
    const a = simulate(structuredClone(state), [], seed);
    const b = simulate(structuredClone(state), [], seed);
    assert.deepEqual(a, b, `seed ${seed}`);
  }
});

test('the state hash is stable across independent runs', () => {
  for (let worldSeed = 1; worldSeed <= SEEDS; worldSeed++) {
    const a = run(freshWorld({ seed: worldSeed }), 50, worldSeed);
    const b = run(freshWorld({ seed: worldSeed }), 50, worldSeed);
    assert.equal(stateHash(a.state), stateHash(b.state), `world seed ${worldSeed}`);
    assert.deepEqual(a.facts, b.facts, `world seed ${worldSeed}`);
  }
});

test('different world seeds tell different stories', () => {
  const lines = new Set<string>();
  for (let worldSeed = 1; worldSeed <= 10; worldSeed++) {
    lines.add(run(freshWorld({ seed: worldSeed }), 100, worldSeed).facts.map((f) => f.line).join('|'));
  }
  assert.ok(lines.size > 1);
});

test('the state hash changes when the world does', () => {
  let state = freshWorld();
  const before = stateHash(state);
  // Step until something happens.
  for (let i = 0; i < 200; i++) {
    const r = step(state);
    state = r.state;
    if (r.facts.length > 0) break;
  }
  assert.notEqual(stateHash(state), before);
});
