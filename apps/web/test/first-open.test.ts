// #43 First open and hints: the order of the first open, the guided Rumour's suggested picks, the hints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HINTS, nextStep, progressAfter, resumeFirstOpen, suggestRumour, type Hint } from '../src/first-open.ts';

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

// Closing the app mid-way must not lose the rest of the first open: begin_first_open is true only once, so
// the device remembers how far it got (per world and Player) and picks up from there.
test('a first open that was cut short resumes where it stopped, from what the device remembers', () => {
  assert.deepEqual(resumeFirstOpen(true, null), { running: true, done: null });
  assert.deepEqual(resumeFirstOpen(false, 'begun'), { running: true, done: null }, 'closed during the Introduction');
  assert.deepEqual(resumeFirstOpen(false, 'introduction'), { running: true, done: 'introduction' }, 'closed on the edition');
  assert.deepEqual(resumeFirstOpen(false, 'edition'), { running: true, done: 'edition' }, 'closed before the guided Rumour');
  assert.equal(nextStep(true, resumeFirstOpen(false, 'edition').done), 'rumour');
});

test('a finished first open, or none at all, never comes back', () => {
  assert.deepEqual(resumeFirstOpen(false, null), { running: false, done: null });
  assert.deepEqual(resumeFirstOpen(false, 'rumour'), { running: false, done: null });
  assert.deepEqual(resumeFirstOpen(false, 'nonsense'), { running: false, done: null });
});

test('the device remembers each step until the last, then forgets', () => {
  assert.equal(progressAfter(null), 'begun');
  assert.equal(progressAfter('introduction'), 'introduction');
  assert.equal(progressAfter('edition'), 'edition');
  assert.equal(progressAfter('rumour'), null);
});
