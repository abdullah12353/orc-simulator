import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPrefix, buildClashMessages, buildHeraldMessages, buildCalibrationMessages, calibrationInputs, parseCalibrationSamples, loadToneBible } from '../prompt.mjs';

const cast = {
  krug: { id: 'krug', name: 'Krúg', accent: 'cockney', traits: ['Mummy\'s Boy', 'Little Fortresser'], fear: 'Water' },
  snarlbottom: { id: 'snarlbottom', name: 'Lord Snarlbottom', accent: 'posh RP', traits: ['Snob', 'Vain'], fear: 'Soap' },
  gobbo: { id: 'gobbo', name: 'Big Gobbo', accent: 'West Country', traits: ['Glutton', 'Gullible'], fear: 'Doctors' },
};
const base = {
  id: 'f1', a: 'krug', b: 'snarlbottom', winner: 'snarlbottom', loser: 'krug', result: 'DEFEATED',
  why: 'Rumour (wrong orc): "Krúg says Grishnack\'s helmet is a bucket" reached Snarlbottom, who wears a bucket.',
  grudges: ['snarlbottom → krug: "called my helmet a bucket"'],
  blame: 'Rumour planted by Haris', accusation: 'Krúg accuses Hari of putting the moat there',
};

test('the system prefix is byte-identical across different Clash and Herald calls', () => {
  const prefix = loadPrefix();
  const m1 = buildClashMessages(prefix, base, cast);
  const m2 = buildClashMessages(prefix, { ...base, id: 'f2', saviour: 'gobbo', rumourLine: 'his mum smells of bins' }, cast);
  const h = buildHeraldMessages(prefix, { id: 'h1', events: ['Krúg fell in the moat.'] });
  assert.equal(m1[0].role, 'system');
  assert.equal(m1[0].content, m2[0].content);
  assert.equal(m1[0].content, h[0].content);
  assert.equal(loadPrefix(), prefix);
});

test('the prefix carries the tone bible, including the calibration samples', () => {
  const prefix = loadPrefix();
  assert.match(prefix, /Exit means exit\. I ain't leaving the throne/);
  assert.match(prefix, /swap test/i);
});

test('the Clash input carries Fact, both cards, Grudges, saviour card and the Player line', () => {
  const fact = { ...base, saviour: 'gobbo', rumourLine: 'his mum smells of bins', trophy: { item: 'nose ring', from: 'krug', to: 'snarlbottom' } };
  const user = buildClashMessages(loadPrefix(), fact, cast)[1].content;
  for (const s of ['Lord Snarlbottom', 'Krúg', 'Big Gobbo', 'called my helmet a bucket', 'his mum smells of bins', 'nose ring', 'helmet is a bucket']) {
    assert.ok(user.includes(s), `missing ${s}`);
  }
});

test('Blame and Accusations never go to the model', () => {
  const user = buildClashMessages(loadPrefix(), base, cast)[1].content;
  assert.ok(!user.includes('Haris'));
  assert.ok(!user.includes('Hari'));
  const h = buildHeraldMessages(loadPrefix(), { id: 'h1', events: ['Krúg fell in the moat.'], blame: ['planted by Haris'] })[1].content;
  assert.ok(!h.includes('Haris'));
});

test('calibration inputs: one per §6 orc voice, mapped to its Captain, asking for 3 new lines', async () => {
  const { CAST } = await import('../fixtures/cast.mjs');
  const cals = calibrationInputs(parseCalibrationSamples(loadToneBible()), CAST);
  assert.deepEqual(cals.map((c) => c.speaker), ['krug', 'snarlbottom', 'mudgut', 'skagrot', 'grishnack', 'vorgash', 'grimbo']);
  const krug = cals[0];
  assert.equal(krug.id, 'cal-krug');
  assert.equal(krug.samples.length, 4);
  const [system, user] = buildCalibrationMessages(loadPrefix(), krug, CAST);
  assert.equal(system.content, loadPrefix());
  const input = JSON.parse(user.content);
  assert.equal(input.task, 'calibration');
  assert.deepEqual(input.speakerIds, ['krug']);
  assert.equal(input.expectedLines, 3);
  assert.equal(input.captain.name, 'Krúg');
  assert.ok(input.samples.some((s) => s.startsWith('"Exit means exit.')));
});

test('the prefix explains the calibration task', () => {
  assert.match(loadPrefix(), /TASK "calibration"/);
});

test('calibration samples are parsed from tone bible §6 per voice', () => {
  const groups = parseCalibrationSamples(loadToneBible());
  const krug = groups.find((g) => g.who.startsWith('Krúg'));
  assert.equal(krug.lines.length, 4);
  const herald = groups.find((g) => g.who.startsWith('The Gutter Herald'));
  assert.equal(herald.lines.length, 3);
  assert.equal(groups.length, 8);
});
