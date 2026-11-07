// #70: the banner the usage guard's state shows when a world opens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gutterNotice } from '../src/gutter.ts';

test("slow and closed say so in the gutter's words; normal says nothing", () => {
  assert.equal(gutterNotice({ state: 'slow' })?.line, "The gutter's gone slow.");
  assert.equal(gutterNotice({ state: 'closed' })?.line, 'The gutter is closed till the 1st.');
  assert.equal(gutterNotice({ state: 'normal' }), null);
});

test('an answer we do not understand shows nothing', () => {
  for (const answer of [null, undefined, 'closed', {}, { state: 'CLOSED' }, { error: 'not found' }]) assert.equal(gutterNotice(answer), null);
});
