import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content } from '@orc/content';
import { castWorld, DAY_ZERO, dayZero, stateHash } from '@orc/sim';
import { run, SEEDS, T0 } from './support.ts';

const DAY_MS = 24 * 60 * 60_000;
const ms = (iso: string) => Date.parse(iso);

test('day zero runs about 288 unwatched 5-minute steps, ending at the moment of creation', () => {
  const { state, steps } = dayZero(content, 7, T0, 'world-1');
  assert.equal(DAY_ZERO.steps, 288);
  assert.equal(steps.length, 288);
  steps.forEach((s, i) => {
    assert.equal(s.tickSeq, i + 1);
    assert.equal(ms(s.at), ms(T0) - DAY_MS + (i + 1) * 5 * 60_000);
  });
  assert.equal(state.world.tickSeq, 288);
  assert.equal(state.world.now, T0);
  assert.equal(state.world.watched, false);
  assert.equal(state.world.id, 'world-1');
});

test('day zero fills the previous 24 h with about 25 Facts', () => {
  let total = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { steps } = dayZero(content, seed, T0, 'w');
    const facts = steps.flatMap((s) => s.facts);
    total += facts.length;
    for (const f of facts) {
      assert.ok(ms(f.at) > ms(T0) - DAY_MS && ms(f.at) <= ms(T0), `${f.at} is inside the previous 24 h`);
    }
  }
  const mean = total / SEEDS;
  assert.ok(mean > 18 && mean < 40, `mean ${mean} Facts per day zero`);
});

test('day zero is the same as casting at created_at − 24 h and stepping the world, tick by tick', () => {
  const start = new Date(ms(T0) - DAY_MS).toISOString();
  for (let seed = 1; seed <= Math.min(SEEDS, 10); seed++) {
    const cast = castWorld(content, seed, start, []);
    const expected = run({ ...cast, world: { ...cast.world, id: 'w' } }, 288, seed);
    const { state, steps } = dayZero(content, seed, T0, 'w');
    assert.equal(stateHash(state), stateHash(expected.state), `seed ${seed}`);
    assert.deepEqual(steps.flatMap((s) => s.facts), expected.facts);
    assert.equal(steps.at(-1)!.stateHash, stateHash(state), 'the last step records the final state hash');
  }
});

test('the same seed always gives the same day zero', () => {
  const a = dayZero(structuredClone(content), 42, T0, 'w');
  const b = dayZero(structuredClone(content), 42, T0, 'w');
  assert.deepEqual(a.steps, b.steps);
  assert.equal(stateHash(a.state), stateHash(b.state));
});
