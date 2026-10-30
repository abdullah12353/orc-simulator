import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composePortrait, content, marksAsOf } from '@orc/content';

// The portrait compositor (#18, D60, #33): at most 3 overlays show; the newest pick which, the mouth
// bandage and the active disguise are pinned into the 3, and a lost tusk and the Legendary stamp sit
// outside the limit. Layers stack by slot (bottom first), never by when they were gained.

/** Active Humiliations in the order he gained them (row numbers rise with time). */
const gained = (...keys: string[]) => keys.map((key, i) => ({ key, no: 100 + i }));
const shown = (keys: string[], legendary = false) =>
  composePortrait(content, { captainId: 'krug', marks: gained(...keys), legendary }).layers.map((l) => l.key);

test('5 active overlays including a mouth bandage: the bandage plus the 2 newest others', () => {
  assert.deepEqual(
    shown(['bandage.mouth', 'lost.ear', 'bandage.head', 'lost.hook', 'lost.peg-leg']),
    ['lost.hook', 'lost.peg-leg', 'bandage.mouth'],
  );
});

test('a lost tusk shows on top of 3 other overlays (it sits outside the limit)', () => {
  assert.deepEqual(shown(['lost.tusk', 'lost.ear', 'bandage.eyepatch', 'bandage.head']), [
    'lost.tusk',
    'lost.ear',
    'bandage.eyepatch',
    'bandage.head',
  ]);
});

test('the tusk still shows when 3 newer overlays have filled the limit', () => {
  assert.deepEqual(shown(['lost.tusk', 'lost.ear', 'lost.hook', 'bandage.eyepatch', 'bandage.head']), [
    'lost.tusk',
    'lost.hook',
    'bandage.eyepatch',
    'bandage.head',
  ]);
});

test('layers follow the slot order whatever order the overlays were gained in', () => {
  // Bucket (slot 8) over eyepatch (5) over hook (3), gained in three different orders.
  const expected = ['lost.hook', 'bandage.eyepatch', 'disguise.bucket'];
  assert.deepEqual(shown(['disguise.bucket', 'bandage.eyepatch', 'lost.hook']), expected);
  assert.deepEqual(shown(['lost.hook', 'disguise.bucket', 'bandage.eyepatch']), expected);
  assert.deepEqual(shown(['bandage.eyepatch', 'lost.hook', 'disguise.bucket']), expected);
});

test('the active disguise is pinned: newer injuries never push it off the face', () => {
  assert.deepEqual(shown(['disguise.wig', 'lost.ear', 'lost.hook', 'bandage.eyepatch', 'bandage.head']), [
    'bandage.eyepatch',
    'bandage.head',
    'disguise.wig',
  ]);
});

test('a muffled, disguised Captain shows both pins and the newest other', () => {
  assert.deepEqual(shown(['bandage.mouth', 'disguise.moustache', 'lost.ear', 'lost.hook', 'bandage.head']), [
    'disguise.moustache',
    'bandage.mouth',
    'bandage.head',
  ]);
});

test('the Legendary stamp is a frame on top of everything, outside the limit', () => {
  assert.deepEqual(shown(['lost.tusk', 'lost.ear', 'bandage.eyepatch', 'disguise.bucket'], true), [
    'lost.tusk',
    'lost.ear',
    'bandage.eyepatch',
    'disguise.bucket',
    'legendary',
  ]);
});

test('Epithets and Fears leave no mark on the face, and unknown kinds are ignored', () => {
  assert.deepEqual(shown(['epithet.the-damp', 'fear.water', 'bandage.head', 'no.such-kind']), ['bandage.head']);
});

test('what the limit leaves off is reported, newest first, and muffling counts every mark', () => {
  const p = composePortrait(content, {
    captainId: 'krug',
    marks: gained('bandage.mouth', 'lost.ear', 'bandage.head', 'lost.hook', 'lost.peg-leg'),
  });
  assert.deepEqual(p.hidden, ['bandage.head', 'lost.ear']);
  assert.equal(p.muffled, true);
  assert.equal(composePortrait(content, { captainId: 'krug', marks: gained('bandage.head') }).muffled, false);
});

test('the base and each layer point at their WebP art; a card nudges only the overlays it overrides', () => {
  const bundle = structuredClone(content);
  bundle.cast.find((c) => c.id === 'krug')!.faceBox = { 'lost.hook': { x: 14, y: -6 } };
  const p = composePortrait(bundle, { captainId: 'krug', marks: gained('lost.hook', 'bandage.head') });
  assert.equal(p.base, 'portraits/krug.webp');
  assert.deepEqual(p.layers, [
    { key: 'lost.hook', slot: 3, src: 'portraits/overlays/lost.hook.webp', nudge: { x: 14, y: -6 } },
    { key: 'bandage.head', slot: 6, src: 'portraits/overlays/bandage.head.webp' },
  ]);
});

test('marks as of a Fact: gained by then and not yet ended (ended rows are kept as history)', () => {
  const rows = [
    { kind: 'disguise.wig', no: 10, gainedFact: 9, endedFact: 40 }, // Unmasked at Fact 40
    { kind: 'bandage.head', no: 21, gainedFact: 20, endedFact: null },
    { kind: 'lost.ear', no: 51, gainedFact: 50, endedFact: null }, // gained later
  ];
  assert.deepEqual(marksAsOf(rows, 30), [
    { key: 'disguise.wig', no: 10 },
    { key: 'bandage.head', no: 21 },
  ]);
  assert.deepEqual(marksAsOf(rows, 40), [{ key: 'bandage.head', no: 21 }], 'gone the moment it ended');
  assert.deepEqual(marksAsOf(rows, 50), [
    { key: 'bandage.head', no: 21 },
    { key: 'lost.ear', no: 51 },
  ], 'on the face from the Fact that gave it');
});

test('within one slot the newer overlay goes on top', () => {
  assert.deepEqual(shown(['bandage.mouth', 'bandage.eyepatch']), ['bandage.mouth', 'bandage.eyepatch']);
  assert.deepEqual(shown(['bandage.eyepatch', 'bandage.mouth']), ['bandage.eyepatch', 'bandage.mouth']);
});
