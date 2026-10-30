// #41: the pure parts of a Clipping's shared image: word wrap and the file it's saved as.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clippingFileName, wrapText } from '../src/clipping-layout.ts';

const chars = (s: string) => s.length;

test('text wraps at word breaks within the width, and an over-long word gets its own line', () => {
  assert.deepEqual(wrapText('KRÚG DROWNS IN THIRTY CENTIMETRES OF MOAT', 14, chars), ['KRÚG DROWNS IN', 'THIRTY', 'CENTIMETRES OF', 'MOAT']);
  assert.deepEqual(wrapText('Aaaaaaaaaaaaaaaaaaaa b', 5, chars), ['Aaaaaaaaaaaaaaaaaaaa', 'b']);
  assert.deepEqual(wrapText('  spaced   out  ', 40, chars), ['spaced out']);
  assert.deepEqual(wrapText('', 40, chars), []);
});

test('the image is named after the story and its headline', () => {
  assert.equal(clippingFileName({ storyNo: 412, headline: 'KRÚG IN MOAT SHOCK: "It was wet," he says' }), 'gutter-herald-412-krug-in-moat-shock-it-was-wet-he-says.png');
  assert.equal(clippingFileName({ storyNo: 7, headline: '!!!' }), 'gutter-herald-7.png');
});
