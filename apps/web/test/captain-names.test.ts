// US78: a disguised Captain goes by one of his two aliases ("Krúg Bootleg") until he's Unmasked, wherever
// he's named: his card, the Clash card and the Meddle pickers. One helper names Captains everywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aliasAsOf, captainName, goesBy, pickerLabel } from '../src/captain-names.ts';

test("a Captain's name comes from the cast; an unknown id is shown as itself", () => {
  assert.equal(captainName('krug'), 'Krúg');
  assert.equal(captainName('nobody'), 'nobody');
});

test('he goes by his name and Epithet, or by his alias while disguised', () => {
  assert.equal(goesBy('krug'), 'Krúg');
  assert.equal(goesBy('krug', { epithet: 'the-barely-awake' }), 'Krúg the Barely Awake');
  assert.equal(goesBy('krug', { epithet: 'the-barely-awake', aliasIdx: 0 }), 'Krúg Bootleg');
  assert.equal(goesBy('krug', { aliasIdx: 1 }), 'Kevin');
});

test('the Meddle pickers name him the same way, marking the Warlord and the dead', () => {
  assert.equal(pickerLabel('krug', { epithet: null, aliasIdx: 0, roster: 'active' }, 'krug'), 'Krúg Bootleg (Warlord)');
  assert.equal(pickerLabel('krug', { epithet: null, aliasIdx: null, roster: 'dead' }, null), 'Krúg (dead)');
  assert.equal(pickerLabel('krug', undefined, null), 'Krúg');
});

const disguise = (no: number, gainedFact: number, endedFact: number | null) => ({ kind: 'disguise.bucket', no, gainedFact, endedFact });

test('a Clash names a disguised Captain by his alias only if he was in disguise then and still is', () => {
  // In disguise since Fact 10, still now (alias 0): a Clash at Fact 20 calls him Krúg Bootleg.
  assert.equal(aliasAsOf(0, [disguise(1, 10, null)], 20), 0);
  // The Clash came before the disguise.
  assert.equal(aliasAsOf(0, [disguise(1, 10, null)], 5), null);
  // Unmasked since: which alias he used then isn't known any more, so his own name.
  assert.equal(aliasAsOf(null, [disguise(1, 10, 30)], 20), null);
  // Not a disguise at all.
  assert.equal(aliasAsOf(0, [{ kind: 'bandage.head', no: 1, gainedFact: 10, endedFact: null }], 20), null);
});
