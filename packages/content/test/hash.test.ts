import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashString, hashValue } from '@orc/content';

test('hashString is FNV-1a 64-bit (published test vectors)', () => {
  assert.equal(hashString(''), 'cbf29ce484222325');
  assert.equal(hashString('a'), 'af63dc4c8601ec8c');
  assert.equal(hashString('foobar'), '85944171f73967e8');
});

test('hashString covers multi-byte UTF-8 and long input', () => {
  assert.match(hashString('Krúg'), /^[0-9a-f]{16}$/);
  assert.notEqual(hashString('Krúg'), hashString('Krug'));
  assert.equal(hashString('x'.repeat(100_000)), hashString('x'.repeat(100_000)));
});

test('hashValue ignores key order', () => {
  assert.equal(hashValue({ a: 1, b: [1, { c: 2, d: 3 }] }), hashValue({ b: [1, { d: 3, c: 2 }], a: 1 }));
});
