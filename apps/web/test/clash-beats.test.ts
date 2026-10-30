// The Clash card's dialogue beats (#30, #37): a wrong saviour's line crashes in wherever it falls. When
// generated lines swap in mid-card with the saviour somewhere else than the fallback had him, the crash
// moves with him rather than staying at the fallback's position.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dialogueBeat } from '../src/clash-beats.ts';

const line = (speaker: string, text = 'Oi.') => ({ speaker, text });
// Fallback script: the saviour crashes in second. Generated script: third.
const fallback = [line('krug'), line('gob'), line('snaga'), line('krug')];
const generated = [line('krug'), line('snaga'), line('gob'), line('krug')];

test("the saviour's line is the crash; the others are plain lines", () => {
  assert.equal(dialogueBeat(fallback, 1, 'gob').kind, 'crash');
  assert.equal(dialogueBeat(fallback, 2, 'gob').kind, 'line');
});

test('after generated lines land, the crash follows the saviour to his new position', () => {
  assert.equal(dialogueBeat(generated, 1, 'gob').kind, 'line');
  assert.equal(dialogueBeat(generated, 2, 'gob').kind, 'crash');
});

test('a crash holds longer than a line; a line holds by its length, within limits', () => {
  assert.equal(dialogueBeat(fallback, 1, 'gob').ms, 3600);
  assert.equal(dialogueBeat([line('krug', 'Oi.')], 0, null).ms, 2000);
  assert.equal(dialogueBeat([line('krug', 'x'.repeat(500))], 0, null).ms, 3200);
});

test('no saviour, no crash', () => {
  assert.equal(dialogueBeat([line('krug'), line('gob'), line('krug')], 1, null).kind, 'line');
});
