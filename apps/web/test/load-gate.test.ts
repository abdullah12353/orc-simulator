// A tab that loads and then polls (Meddle, Stable) must never show a stale answer: not one that was
// asked for the world before a switch, and not an older poll that came back after a newer one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGate } from '../src/load-gate.ts';

test('an answer to the newest question is taken', () => {
  const gate = loadGate();
  const t = gate.begin();
  assert.equal(gate.accept(t), true);
});

test('an answer for the world before a switch is dropped', () => {
  const gate = loadGate();
  const before = gate.begin();
  gate.reset(); // the world changed (or the tab closed)
  assert.equal(gate.accept(before), false);
  assert.equal(gate.accept(gate.begin()), true);
});

test('an older poll that comes back after a newer one is dropped', () => {
  const gate = loadGate();
  const older = gate.begin();
  const newer = gate.begin();
  assert.equal(gate.accept(newer), true);
  assert.equal(gate.accept(older), false);
});

test('an older poll that comes back first is still shown until the newer one lands', () => {
  const gate = loadGate();
  const older = gate.begin();
  const newer = gate.begin();
  assert.equal(gate.accept(older), true);
  assert.equal(gate.accept(newer), true);
});
