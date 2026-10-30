import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCENTS, content, validateContent, type Content } from '@orc/content';

const clone = (c: Content): Content => structuredClone(c);
const card = (c: Content, id: string) => c.cast.find((x) => x.id === id)!;

test('the cast is 30 hand-written cards, 5 per accent archetype', () => {
  assert.equal(content.cast.length, 30);
  assert.deepEqual([...ACCENTS].sort(), ['cockney', 'glaswegian', 'indian-english', 'posh', 'scouse', 'west-country']);
  for (const accent of ACCENTS) {
    assert.equal(content.cast.filter((c) => c.accent === accent).length, 5, accent);
  }
});

test("Krúg's card is the worked example", () => {
  const krug = card(content, 'krug');
  assert.equal(krug.name, 'Krúg');
  assert.equal(krug.sayAs, 'KROOG');
  assert.equal(krug.accent, 'cockney');
  assert.deepEqual(krug.traits, ["Mummy's Boy", 'Little Fortresser']);
  assert.deepEqual(krug.fears, ['Water']);
  assert.equal(krug.power, 3);
  assert.equal(krug.catchphrase, 'Exit means exit.');
  assert.equal(krug.epithet, undefined, 'Krúg starts with no Epithet');
});

test('Power sits on a bell curve: mostly 3–6, a couple of 8s and 9s, nobody at 10', () => {
  const powers = content.cast.map((c) => c.power);
  assert.ok(powers.every((p) => p >= 1 && p <= 9), 'nobody at 10');
  assert.ok(powers.filter((p) => p >= 3 && p <= 6).length >= 20, 'mostly 3–6');
  assert.ok(powers.filter((p) => p === 8).length >= 1 && powers.filter((p) => p === 9).length >= 1);
});

test('exactly 6 accusers, and every name, alias and catchphrase is unique', () => {
  assert.equal(content.cast.filter((c) => c.accuser).length, 6);
  const names = content.cast.flatMap((c) => [c.name, ...c.aliases]);
  assert.equal(new Set(names).size, names.length);
  const phrases = content.cast.map((c) => c.catchphrase);
  assert.equal(new Set(phrases).size, phrases.length);
});

test('a card with a Trait outside the shared pool is rejected', () => {
  const broken = clone(content);
  card(broken, 'krug').traits = ["Mummy's Boy", 'Accountant'];
  const errors = validateContent(broken);
  assert.ok(errors.some((e) => e.includes('krug') && e.includes('Accountant')), errors.join('\n'));
});

test('a card with the same Trait twice is rejected', () => {
  const broken = clone(content);
  card(broken, 'krug').traits = ['Glutton', 'Glutton'];
  assert.ok(validateContent(broken).some((e) => e.includes('krug') && e.includes('distinct')));
});

test('a card needs exactly one starting Fear from the pool', () => {
  const none = clone(content);
  card(none, 'krug').fears = [];
  assert.ok(validateContent(none).some((e) => e.includes('krug') && e.includes('Fear')));
  const odd = clone(content);
  card(odd, 'krug').fears = ['Spreadsheets'];
  assert.ok(validateContent(odd).some((e) => e.includes('krug') && e.includes('Spreadsheets')));
});

test('a card with an unknown accent archetype is rejected', () => {
  const broken = clone(content);
  (card(broken, 'krug') as { accent: string }).accent = 'geordie';
  assert.ok(validateContent(broken).some((e) => e.includes('krug') && e.includes('geordie')));
});

test('a starting Epithet must exist in the Epithet bank', () => {
  const broken = clone(content);
  card(broken, 'krug').epithet = 'the-nonexistent';
  assert.ok(validateContent(broken).some((e) => e.includes('krug') && e.includes('the-nonexistent')));
});

test('casting needs Krúg, at least 2 Captains per accent, 6 accusers and enough old history', () => {
  const noKrug = clone(content);
  noKrug.cast = noKrug.cast.filter((c) => c.id !== 'krug');
  assert.ok(validateContent(noKrug).some((e) => e.includes('krug')));

  const thinAccent = clone(content);
  thinAccent.cast = thinAccent.cast.filter((c) => c.accent !== 'scouse' || c.id === 'skagrot');
  assert.ok(validateContent(thinAccent).some((e) => e.includes('scouse')));

  const accusers = clone(content);
  card(accusers, 'vrakk').accuser = true;
  assert.ok(validateContent(accusers).some((e) => e.includes('accuser')));

  const history = clone(content);
  history.banks.oldHistory = history.banks.oldHistory.slice(0, 3);
  assert.ok(validateContent(history).some((e) => e.includes('oldHistory')));
});
