// The Hall's tags for what happened to a Captain speak the GLOSSARY's words, never raw Fact kinds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factKindLabel } from '../src/fact-labels.ts';

test("a Captain's story is tagged in the GLOSSARY's words", () => {
  assert.equal(factKindLabel('death'), 'Death');
  assert.equal(factKindLabel('return'), 'Return');
  assert.equal(factKindLabel('humiliation'), 'Humiliation');
  assert.equal(factKindLabel('trophy'), 'Trophy');
  assert.equal(factKindLabel('legendary'), 'Legendary');
  assert.equal(factKindLabel('warlord_fell'), 'the Warlord fell');
  assert.equal(factKindLabel('stepped_in'), 'Stepped in');
  assert.equal(factKindLabel('death_averted'), 'Death averted');
});

test('an unknown kind still reads as words, every underscore gone', () => {
  assert.equal(factKindLabel('some_new_kind'), 'some new kind');
});
