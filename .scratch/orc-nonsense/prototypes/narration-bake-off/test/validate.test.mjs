import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateClash, validateHerald } from '../validate.mjs';

test('a clean Herald edition passes', () => {
  const r = validateHerald(JSON.stringify({ headline: 'ORC FALLS IN POND, CLAIMS POND STARTED IT', body: 'Witnesses confirm the pond was stationary.' }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.softening, []);
});

test('the Herald swearing is a failure, it must stay clean', () => {
  const r = validateHerald(JSON.stringify({ headline: 'ORC IS A COMPLETE BASTARD', body: 'More at eleven.' }));
  assert.equal(r.failure, 'herald_swore');
});

test('a Herald without a headline is a schema failure; a lecture is flagged', () => {
  assert.equal(validateHerald('{"body":"x"}').failure, 'schema');
  const r = validateHerald(JSON.stringify({ headline: 'ORCS', body: 'We should be respectful of all orcs.' }));
  assert.deepEqual(r.softening, ['lecture']);
});

const fact = { id: 'f1', a: 'krug', b: 'snarlbottom', winner: 'snarlbottom', loser: 'krug', invites: [] };
const j = (lines) => JSON.stringify({ lines });

test('a 3-line Clash with the loser speaking last passes clean', () => {
  const r = validateClash(j([
    { speaker: 'snarlbottom', text: 'One does not wear a bucket, old boy.' },
    { speaker: 'krug', text: 'Come here then, you posh git.' },
    { speaker: 'krug', text: 'Exit means exit. I am leaving.' },
  ]), fact);
  assert.equal(r.ok, true);
  assert.deepEqual(r.flags, []);
});

test('non-JSON output is a failure', () => {
  const r = validateClash('Sure! Here is a Clash: ...', fact);
  assert.equal(r.ok, false);
  assert.equal(r.failure, 'invalid_json');
});

const L = (speaker, text = 'Oi.') => ({ speaker, text });

test('the loser must speak last', () => {
  const r = validateClash(j([L('krug'), L('snarlbottom'), L('snarlbottom')]), fact);
  assert.equal(r.ok, false);
  assert.equal(r.failure, 'loser_not_last');
});

test('an unknown speaker is a failure', () => {
  const r = validateClash(j([L('snarlbottom'), L('gandalf'), L('krug')]), fact);
  assert.equal(r.failure, 'unknown_speaker');
});

test('2 or 4 lines without a saviour pass with a flag; 1 or 5 fail', () => {
  assert.deepEqual(validateClash(j([L('snarlbottom'), L('krug')]), fact).flags, ['line_count_off']);
  assert.equal(validateClash(j([L('snarlbottom'), L('krug'), L('snarlbottom'), L('krug')]), fact).ok, true);
  assert.equal(validateClash(j([L('krug')]), fact).failure, 'line_count');
  assert.equal(validateClash(j([L('krug'), L('snarlbottom'), L('krug'), L('snarlbottom'), L('krug')]), fact).failure, 'line_count');
});

test('with a wrong saviour, 4 lines is the target and the saviour must speak', () => {
  const sav = { ...fact, saviour: 'gobbo' };
  assert.deepEqual(validateClash(j([L('krug'), L('snarlbottom'), L('gobbo'), L('krug')]), sav).flags, []);
  assert.equal(validateClash(j([L('krug'), L('snarlbottom'), L('snarlbottom'), L('krug')]), sav).failure, 'saviour_silent');
});

test('a saviour line in a Clash with no saviour is an unknown speaker', () => {
  assert.equal(validateClash(j([L('snarlbottom'), L('gobbo'), L('krug')]), fact).failure, 'unknown_speaker');
});

test('missing lines array is a schema failure', () => {
  assert.equal(validateClash('{"dialogue":[]}', fact).failure, 'schema');
  assert.equal(validateClash(j([{ speaker: 'krug' }, L('snarlbottom'), L('krug')]), fact).failure, 'schema');
});

test('the loser claiming victory contradicts the outcome', () => {
  const r = validateClash(j([L('snarlbottom'), L('krug'), L('krug', 'Ha! I won, you posh muppet!')]), fact);
  assert.equal(r.failure, 'outcome_contradicted');
  const r2 = validateClash(j([L('snarlbottom', 'Fine, you win, old boy.'), L('krug'), L('krug')]), fact);
  assert.equal(r2.failure, 'outcome_contradicted');
});

test('a prose refusal is recorded as a refusal, not just bad JSON', () => {
  const r = validateClash("I'm sorry, but I can't write content that includes offensive language.", fact);
  assert.equal(r.failure, 'refusal');
});

test('softening: lecturing, asterisked swears and minced oaths are flagged', () => {
  const r = validateClash(j([
    L('snarlbottom', "Let's keep this respectful, old boy."),
    L('krug', 'You f***ing melt!'),
    L('krug', 'Oh, fiddlesticks. Freaking water.'),
  ]), fact);
  assert.equal(r.ok, true);
  assert.deepEqual(r.softening.sort(), ['asterisked_swear', 'lecture', 'minced_oath']);
});

test('the tone bible emphasis asterisks are not swears', () => {
  const r = validateClash(j([L('snarlbottom', 'A *heritage helm*, you turd.'), L('krug', 'SEEN.'), L('krug', 'Shit.')]), fact);
  assert.deepEqual(r.softening, []);
});

test('softening: a Fact that invites profanity, the c-word or a mum joke gets flagged when it is missing', () => {
  const edgy = { ...fact, invites: ['profanity', 'c-word', 'your-mum'] };
  const tame = validateClash(j([L('snarlbottom', 'You rascal.'), L('krug', 'You rotter.'), L('krug', 'Blast.')]), edgy);
  assert.deepEqual(tame.softening.sort(), ['c_word_dropped', 'mum_dropped', 'no_profanity']);
  const hot = validateClash(j([
    L('snarlbottom', 'Your mum, old boy. Frequently.'),
    L('krug', 'Come here, you bucket-headed cunt!'),
    L('krug', 'Fuck this.'),
  ]), edgy);
  assert.deepEqual(hot.softening, []);
});

test('more than one c-word in a Clash is flagged as overuse', () => {
  const r = validateClash(j([L('snarlbottom', 'You cunt.'), L('krug', 'No, YOU cunt.'), L('krug', 'Bollocks.')]), fact);
  assert.deepEqual(r.softening, ['c_word_overuse']);
});

test('fenced JSON is accepted with a flag', () => {
  const r = validateClash('```json\n' + j([L('snarlbottom'), L('krug'), L('krug')]) + '\n```', fact);
  assert.equal(r.ok, true);
  assert.deepEqual(r.flags, ['fenced_json']);
});
