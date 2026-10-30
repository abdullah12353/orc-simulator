import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content, validateContent, type Content } from '@orc/content';

// The v1 catalogue's content check (#44): the tone bible's boundaries, coverage of every Trait and Fear, and
// Templates the sim can actually run.

const clone = (): Content => structuredClone(content);
const errorsOf = (c: Content) => validateContent(c);
const has = (errors: string[], ...words: string[]) =>
  assert.ok(errors.some((e) => words.every((w) => e.includes(w))), `expected an error with ${words.join(' + ')}:\n${errors.join('\n')}`);

test('the Herald never swears: Template lines and the banks that end up in its lines stay clean', () => {
  const c = clone();
  c.templates.find((t) => t.id === 'ambient.moat-dip')!.lines[1] = '{a} fell in the bloody moat while {b} watched.';
  c.banks.oldHistory.push('called him a tosser');
  c.banks.clash.results.won[0] = '{winner} won. {loser} is pissed off.';
  c.banks.dares['stunt.moat-swim']!.text = 'swim the shitty moat';
  const errors = errorsOf(c);
  has(errors, 'ambient.moat-dip', 'bloody');
  has(errors, 'banks.oldHistory', 'tosser');
  has(errors, 'banks.clash.results.won', 'pissed');
  has(errors, 'banks.dares.stunt.moat-swim', 'shitty');
});

test('nothing names a real person or party, or borrows from Tolkien, Shadow of War or Mike Brooks', () => {
  const c = clone();
  c.templates[0]!.lines[0] = '{a} said the moat was the fault of the Tories.';
  c.banks.absurdSubjects['ring'] = 'one ring to rule them all, from Mordor';
  c.banks.clash.scripts[Object.keys(c.banks.clash.scripts)[0]!]!.lines[0]!.text = 'WAAAGH!';
  c.cast[1]!.name = 'Grishnákh';
  const errors = errorsOf(c);
  has(errors, 'templates[0]', 'tories');
  has(errors, 'absurdSubjects', 'mordor');
  has(errors, 'scripts', 'waaagh');
  has(errors, 'cast', 'grishnakh');
  // Brexit is a register, not a topic: pastiche slogans and absurd claims are fine.
  const ok = clone();
  ok.templates[0]!.lines[0] = '{a} is said to have caused Brexit. {b} says exit means exit.';
  assert.deepEqual(errorsOf(ok), []);
});

test('orc banter may swear: fallback Clash scripts, catchphrases and Accusations are not the Herald', () => {
  const c = clone();
  const key = Object.keys(c.banks.clash.scripts)[0]!;
  c.banks.clash.scripts[key]!.lines[0]!.text = "Come 'ere, you shitty little bastard.";
  c.cast[0]!.catchphrase = 'Bollocks to the lot of you.';
  assert.deepEqual(errorsOf(c), []);
});
