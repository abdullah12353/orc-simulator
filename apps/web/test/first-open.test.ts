// #43 First open and hints: the order of the first open, the guided Rumour's suggested picks, the hints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HINTS, nextStep, suggestRumour, type Hint } from '../src/first-open.ts';

test("a first open runs Krúg's Introduction, then the edition, then the guided Rumour, then nothing", () => {
  assert.equal(nextStep(true, null), 'introduction');
  assert.equal(nextStep(true, 'introduction'), 'edition');
  assert.equal(nextStep(true, 'edition'), 'rumour');
  assert.equal(nextStep(true, 'rumour'), null);
});

test('any later open goes straight to the Herald, with no sequence', () => {
  assert.equal(nextStep(false, null), null);
});

const captain = (id: string, traits: string[], roster: 'active' | 'reserve' | 'dead' = 'active') => ({ id, roster, traits });

test("the guided Rumour suggests Krúg telling tales about the Warlord, on one of the Warlord's own Traits", () => {
  const picks = suggestRumour([captain('gob', ['Vain']), captain('krug', ['Hothead']), captain('snaga', ['Coward', 'Vain'])], 'snaga');
  assert.deepEqual(picks, { source: 'krug', target: 'snaga', claim: 'insult', subject: { from: 'trait', key: 'Coward' } });
});

test('with no Warlord (or Krúg on the throne) it picks someone else for each role, never a reserve or the dead', () => {
  const picks = suggestRumour(
    [captain('azog', ['Vain'], 'reserve'), captain('bolg', ['Coward'], 'dead'), captain('gob', ['Vain']), captain('krug', ['Hothead']), captain('snaga', ['Coward'])],
    'krug',
  );
  assert.ok(picks);
  assert.notEqual(picks.source, picks.target);
  assert.ok(['gob', 'krug', 'snaga'].includes(picks.source) && ['gob', 'krug', 'snaga'].includes(picks.target));
  assert.equal(picks.target, 'krug', 'the Warlord is still the target, even when he is Krúg');
  assert.equal(picks.source, 'gob');
  assert.equal(suggestRumour([captain('krug', ['Hothead'])], null), null, 'one Captain is not enough');
});

test('every hint is a single line', () => {
  for (const hint of ['dare', 'backing', 'stable'] satisfies Hint[]) {
    assert.ok(HINTS[hint].length > 0 && HINTS[hint].length <= 140 && !HINTS[hint].includes('\n'), hint);
  }
});
