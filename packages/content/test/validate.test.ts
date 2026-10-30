import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content, validateContent, contentVersion, type Content } from '@orc/content';

const clone = (c: Content): Content => structuredClone(c);

test('the shipped bundle is valid', () => {
  assert.deepEqual(validateContent(content), []);
});

test('a Template with fewer than 3 line variants is rejected', () => {
  const broken = clone(content);
  const t = broken.templates[0]!;
  (t as { lines: string[] }).lines = t.lines.slice(0, 2);
  const errors = validateContent(broken);
  assert.ok(errors.some((e) => e.includes(t.id) && e.includes('3 line variants')), errors.join('\n'));
});

test('a Template pinning a role to a Captain slug missing from the cast is rejected', () => {
  const broken = clone(content);
  broken.templates[0]!.roles[0]!.captain = 'no-such-orc';
  const errors = validateContent(broken);
  assert.ok(errors.some((e) => e.includes('no-such-orc')), errors.join('\n'));
});

test('a line naming a role the Template does not cast is rejected', () => {
  const broken = clone(content);
  broken.templates[0]!.lines[1] = '{ghost} fell in the moat';
  const errors = validateContent(broken);
  assert.ok(errors.some((e) => e.includes('{ghost}')), errors.join('\n'));
});

test('a Template with an empty outcome table is rejected', () => {
  const broken = clone(content);
  broken.templates[0]!.outcomes = [];
  const errors = validateContent(broken);
  assert.ok(errors.some((e) => e.includes('outcome')), errors.join('\n'));
});

test('a cast card missing a field the sim needs is rejected', () => {
  const broken = clone(content);
  delete (broken.cast[0] as Partial<(typeof broken.cast)[0]>).name;
  const errors = validateContent(broken);
  assert.ok(errors.some((e) => e.includes(broken.cast[0]!.id) && e.includes('name')), errors.join('\n'));
});

test('duplicate slugs are rejected', () => {
  const broken = clone(content);
  broken.cast.push(structuredClone(broken.cast[0]!));
  const errors = validateContent(broken);
  assert.ok(errors.some((e) => e.includes('duplicate')), errors.join('\n'));
});

test('the Herald masthead needs 7 orc weekdays, 12 orc months, price gags and weather', () => {
  const broken = clone(content);
  broken.banks.masthead.days = broken.banks.masthead.days.slice(0, 6);
  broken.banks.masthead.months = broken.banks.masthead.months.slice(0, 11);
  broken.banks.masthead.prices = [];
  broken.banks.masthead.weather = [];
  const errors = validateContent(broken);
  for (const part of ['days', 'months', 'prices', 'weather']) {
    assert.ok(errors.some((e) => e.includes(`masthead.${part}`)), `${part}: ${errors.join('\n')}`);
  }
});

test('the content version is a stable hash that changes when the content does', () => {
  assert.equal(contentVersion(content), contentVersion(clone(content)));
  const edited = clone(content);
  edited.templates[0]!.lines[0] = edited.templates[0]!.lines[0] + '!';
  assert.notEqual(contentVersion(edited), contentVersion(content));
  assert.match(contentVersion(content), /^[0-9a-f]{16}$/);
});
