import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorldState } from '@orc/sim';
import { freshWorld, step } from './support.ts';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// 23:55 London on 30 Oct 2026 is 23:55 UTC (BST ended on the 25th), so the next 5-minute tick crosses midnight.
const BEFORE_MIDNIGHT = '2026-10-30T23:55:00.000Z';

function world(meddles: Record<string, number>, affinity: WorldState['affinity'] = {}): WorldState {
  const state = freshWorld({ now: BEFORE_MIDNIGHT, players: Object.keys(meddles) });
  const players = Object.fromEntries(Object.entries(state.players).map(([id, p]) => [id, { ...p, meddles: meddles[id]! }]));
  return { ...state, players, affinity };
}

test('the day roll at midnight London grants every Player 3 Meddles, capped at 6', () => {
  const r = step(world({ [A]: 0, [B]: 2, [C]: 5 }));
  assert.equal(r.state.world.day, '2026-10-31');
  assert.equal(r.state.players[A]!.meddles, 3);
  assert.equal(r.state.players[B]!.meddles, 5);
  assert.equal(r.state.players[C]!.meddles, 6, 'banked up to 6, the rest is lost');
});

test('the day rolls once: later ticks the same day grant nothing', () => {
  let state = step(world({ [A]: 0 })).state;
  for (let i = 0; i < 20; i++) state = step(state).state;
  assert.equal(state.players[A]!.meddles, 3);
  assert.equal(state.world.day, '2026-10-31');
});

test('no roll inside a London day, even across UTC midnight in summer', () => {
  // 23:30 UTC on 1 July is 00:30 London the next day: that midnight already rolled.
  const summer = freshWorld({ now: '2026-07-01T23:30:00.000Z', players: [A] });
  assert.equal(summer.world.day, '2026-07-02');
  const r = step(summer, undefined, 60);
  assert.equal(r.state.players[A]!.meddles, 3);
  assert.equal(r.diff.world.day, undefined);
});

test('the day roll resets the death counter', () => {
  const state = world({ [A]: 0 });
  const r = step({ ...state, world: { ...state.world, deathsToday: 3 } });
  assert.equal(r.state.world.deathsToday, 0);
});

test('affinity drifts 5 a day towards 0, and rows that reach 0 are deleted', () => {
  const r = step(
    world({}, { 'krug>gob': -60, 'gob>krug': 40, 'a>b': -3, 'b>a': 5, 'c>d': -100, 'd>c': 100 }),
  );
  assert.deepEqual(r.state.affinity, { 'krug>gob': -55, 'gob>krug': 35, 'c>d': -95, 'd>c': 95 });
  assert.ok(r.diff.affinity.some((a) => a.holder === 'a' && a.toward === 'b' && a.value === 0), '0 deletes the row');
});

test('affinity holds still between day rolls', () => {
  const state = { ...freshWorld({ players: [A] }), affinity: { 'krug>gob': -60 } as WorldState['affinity'] };
  let s = state;
  for (let i = 0; i < 10; i++) s = step(s).state; // 12:00 → 12:50, same day
  assert.equal(s.affinity['krug>gob'], -60);
});
