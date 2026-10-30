import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content } from '@orc/content';
import { dayZero, simulate, tickSeed, type WorldState } from '@orc/sim';
import { freshWorld, SEEDS, WORLD_SEED } from './support.ts';

/** Runs fn with Date, Math.random and crypto booby-trapped, so any use inside the sim throws. */
function withoutClockOrEntropy<T>(fn: () => T): T {
  const RealDate = globalThis.Date;
  const realRandom = Math.random;
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const trap = (what: string) => () => {
    throw new Error(`sim touched ${what}`);
  };
  globalThis.Date = new Proxy(RealDate, {
    construct: trap('new Date()'),
    apply: trap('Date()'),
    get: (target, prop, receiver) => (prop === 'now' ? trap('Date.now') : Reflect.get(target, prop, receiver)),
  });
  Math.random = trap('Math.random');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, get: trap('crypto') });
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
    Math.random = realRandom;
    if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
  }
}

test('the sim never reads the wall clock: Facts are stamped with state.world.now', () => {
  // A "now" far from the real present, so a wall-clock read couldn't pass by accident.
  const now = '2031-02-03T04:05:00.000Z';
  let facts = 0;
  for (const watched of [true, false]) {
    const state: WorldState = freshWorld({ now, watched });
    for (let seq = 1; seq <= SEEDS * 20; seq++) {
      const { facts: out } = withoutClockOrEntropy(() =>
        simulate({ ...state, world: { ...state.world, tickSeq: seq } }, [], tickSeed(WORLD_SEED, seq)),
      );
      for (const f of out) assert.equal(f.at, now);
      facts += out.length;
    }
  }
  assert.ok(facts > 0, 'expected some Facts to check');
});

test('casting and the day-zero pre-roll never read the wall clock either', () => {
  const now = '2031-02-03T04:05:06.789Z';
  const { state, steps } = withoutClockOrEntropy(() => dayZero(content, WORLD_SEED, now, 'w'));
  assert.equal(state.world.now, now);
  assert.equal(steps[0]!.at, '2031-02-02T04:10:06.789Z');
  const facts = steps.flatMap((s) => s.facts);
  assert.ok(facts.length > 0);
  for (const f of facts) assert.ok(f.at > '2031-02-02T04:05:06.789Z' && f.at <= now, f.at);
});
