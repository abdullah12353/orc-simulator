// D55: the Hall is kept forever, so its long lists (Moments, the timeline, Clippings) page with
// "Show more" instead of stopping at a fixed count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPage, nextRange } from '../src/paging.ts';

const key = (n: number) => String(n);

test('the next page starts where the shown ones end', () => {
  assert.deepEqual(nextRange(0, 50), { from: 0, to: 49 });
  assert.deepEqual(nextRange(50, 50), { from: 50, to: 99 });
});

test('a full page offers more; a short one is the end', () => {
  assert.deepEqual(addPage([], [1, 2], 2, key), { items: [1, 2], more: true });
  assert.deepEqual(addPage([1, 2], [3], 2, key), { items: [1, 2, 3], more: false });
  assert.deepEqual(addPage([1, 2], [], 2, key), { items: [1, 2], more: false });
});

test('a row already shown is not shown twice when new entries pushed the pages along', () => {
  // Newest first: a new entry arrived on top, so the old page 2 starts with the last row of page 1.
  assert.deepEqual(addPage([9, 8], [8, 7], 2, key), { items: [9, 8, 7], more: true });
});
