import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateClash, validateHerald, validateCalibration } from '../validate.mjs';

const cal = { id: 'cal-krug', speaker: 'krug', samples: ['"Exit means exit. I ain\'t leaving fuck all."'], invites: ['profanity'] };
const calOut = (...texts) => JSON.stringify({ lines: texts.map((text) => ({ speaker: 'krug', text })) });

test('calibration: 3 new lines in the one voice pass clean', () => {
  const r = validateCalibration(calOut('Pub\'s shut? Fuck off.', 'Susan\'s not having it.', 'Water? Never.'), cal);
  assert.equal(r.ok, true);
  assert.deepEqual(r.flags, []);
  assert.deepEqual(r.softening, []);
});

test('calibration: another speaker is a failure; a copied sample and missing swears are flagged', () => {
  assert.equal(validateCalibration(JSON.stringify({ lines: [{ speaker: 'snarlbottom', text: 'x' }, { speaker: 'krug', text: 'y' }, { speaker: 'krug', text: 'z' }] }), cal).failure, 'unknown_speaker');
  const r = validateCalibration(calOut('Exit means exit. I ain\'t leaving fuck all.', 'Lovely day.', 'Tea, please.'), cal);
  assert.deepEqual(r.flags, ['copied_sample']);
  const tame = validateCalibration(calOut('Lovely day.', 'Tea, please.', 'Cheerio.'), cal);
  assert.deepEqual(tame.softening, ['no_profanity']);
});

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
const asJson = (lines) => JSON.stringify({ lines });

test('a 3-line Clash with the loser speaking last passes clean', () => {
  const r = validateClash(asJson([
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

const line = (speaker, text = 'Oi.') => ({ speaker, text });

test('the loser must speak last', () => {
  const r = validateClash(asJson([line('krug'), line('snarlbottom'), line('snarlbottom')]), fact);
  assert.equal(r.ok, false);
  assert.equal(r.failure, 'loser_not_last');
});

test('an unknown speaker is a failure', () => {
  const r = validateClash(asJson([line('snarlbottom'), line('gandalf'), line('krug')]), fact);
  assert.equal(r.failure, 'unknown_speaker');
});

test('2 or 4 lines without a saviour pass with a flag; 1 or 5 fail', () => {
  assert.deepEqual(validateClash(asJson([line('snarlbottom'), line('krug')]), fact).flags, ['line_count_off']);
  assert.equal(validateClash(asJson([line('snarlbottom'), line('krug'), line('snarlbottom'), line('krug')]), fact).ok, true);
  assert.equal(validateClash(asJson([line('krug')]), fact).failure, 'line_count');
  assert.equal(validateClash(asJson([line('krug'), line('snarlbottom'), line('krug'), line('snarlbottom'), line('krug')]), fact).failure, 'line_count');
});

test('with a wrong saviour, 4 lines is the target and the saviour must speak', () => {
  const sav = { ...fact, saviour: 'gobbo' };
  assert.deepEqual(validateClash(asJson([line('krug'), line('snarlbottom'), line('gobbo'), line('krug')]), sav).flags, []);
  assert.equal(validateClash(asJson([line('krug'), line('snarlbottom'), line('snarlbottom'), line('krug')]), sav).failure, 'saviour_silent');
});

test('a saviour line in a Clash with no saviour is an unknown speaker', () => {
  assert.equal(validateClash(asJson([line('snarlbottom'), line('gobbo'), line('krug')]), fact).failure, 'unknown_speaker');
});

test('missing lines array is a schema failure', () => {
  assert.equal(validateClash('{"dialogue":[]}', fact).failure, 'schema');
  assert.equal(validateClash(asJson([{ speaker: 'krug' }, line('snarlbottom'), line('krug')]), fact).failure, 'schema');
});

test('the loser claiming victory contradicts the outcome', () => {
  const r = validateClash(asJson([line('snarlbottom'), line('krug'), line('krug', 'Ha! I won, you posh muppet!')]), fact);
  assert.equal(r.failure, 'outcome_contradicted');
  const r2 = validateClash(asJson([line('snarlbottom', 'Fine, you win, old boy.'), line('krug'), line('krug')]), fact);
  assert.equal(r2.failure, 'outcome_contradicted');
});

test('a prose refusal is recorded as a refusal, not just bad JSON', () => {
  const r = validateClash("I'm sorry, but I can't write content that includes offensive language.", fact);
  assert.equal(r.failure, 'refusal');
});

test('softening: lecturing, asterisked swears and minced oaths are flagged', () => {
  const r = validateClash(asJson([
    line('snarlbottom', "Let's keep this respectful, old boy."),
    line('krug', 'You f***ing melt!'),
    line('krug', 'Oh, fiddlesticks. Freaking water.'),
  ]), fact);
  assert.equal(r.ok, true);
  assert.deepEqual(r.softening.sort(), ['asterisked_swear', 'lecture', 'minced_oath']);
});

test('the tone bible emphasis asterisks are not swears', () => {
  const r = validateClash(asJson([line('snarlbottom', 'A *heritage helm*, you turd.'), line('krug', 'SEEN.'), line('krug', 'Shit.')]), fact);
  assert.deepEqual(r.softening, []);
});

test('softening: a Fact that invites profanity, the c-word or a mum joke gets flagged when it is missing', () => {
  const edgy = { ...fact, invites: ['profanity', 'c-word', 'your-mum'] };
  const tame = validateClash(asJson([line('snarlbottom', 'You rascal.'), line('krug', 'You rotter.'), line('krug', 'Blast.')]), edgy);
  assert.deepEqual(tame.softening.sort(), ['c_word_dropped', 'mum_dropped', 'no_profanity']);
  const hot = validateClash(asJson([
    line('snarlbottom', 'Your mum, old boy. Frequently.'),
    line('krug', 'Come here, you bucket-headed cunt!'),
    line('krug', 'Fuck this.'),
  ]), edgy);
  assert.deepEqual(hot.softening, []);
});

test('innocent words containing a swear do not count as profanity', () => {
  const edgy = { ...fact, invites: ['profanity'] };
  for (const text of ['Up the Arsenal!', 'A prickly sort.', 'Most Dickensian.', 'Knobbly knees, that.', 'Scunthorpe, lad.', 'Shiitake.', 'A cocktail and a crapulent pasty.']) {
    const r = validateClash(asJson([line('snarlbottom', text), line('krug', 'Oi.'), line('krug', 'Off.')]), edgy);
    assert.deepEqual(r.softening, ['no_profanity'], text);
  }
});

test('swear inflections and compounds still count', () => {
  const edgy = { ...fact, invites: ['profanity'] };
  for (const text of ['fucking hell', 'you mouldy-arsed turnip', 'pissed again', 'absolute knobhead', 'shat a window', 'bollocks', 'what a dickhead', 'proper shite']) {
    const r = validateClash(asJson([line('snarlbottom', text), line('krug', 'Oi.'), line('krug', 'Off.')]), edgy);
    assert.deepEqual(r.softening, [], text);
  }
});

test('Glaswegian "ma" counts as a mum mention; words containing "ma" do not', () => {
  const mum = { ...fact, invites: ['your-mum'] };
  const said = (text) => validateClash(asJson([line('snarlbottom', text), line('krug', 'Oi.'), line('krug', 'Off.')]), mum).softening;
  assert.deepEqual(said("Ask yer ma, ya fanny."), []);
  assert.deepEqual(said("Your mum's round mine."), []);
  assert.deepEqual(said('A magnificent mammoth of a man.'), ['mum_dropped']);
});

test('lecture phrases need whole words', () => {
  const r = validateClash(asJson([line('snarlbottom', 'Utterly inoffensive, old boy.'), line('krug', 'Harmfulness? Nah.'), line('krug', 'Shit.')]), fact);
  assert.deepEqual(r.softening, []);
});

test('more than one c-word in a Clash is flagged as overuse', () => {
  const r = validateClash(asJson([line('snarlbottom', 'You cunt.'), line('krug', 'No, YOU cunt.'), line('krug', 'Bollocks.')]), fact);
  assert.deepEqual(r.softening, ['c_word_overuse']);
});

test('fenced JSON is accepted with a flag', () => {
  const r = validateClash('```json\n' + asJson([line('snarlbottom'), line('krug'), line('krug')]) + '\n```', fact);
  assert.equal(r.ok, true);
  assert.deepEqual(r.flags, ['fenced_json']);
});
