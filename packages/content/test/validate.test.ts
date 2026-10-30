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

test('a face-box override must name an overlay (a Humiliation with one, or the Legendary stamp)', () => {
  const broken = clone(content);
  broken.cast[0]!.faceBox = { 'lost.hook': { x: 10 }, legendary: { scale: 0.9 }, 'fear.water': { y: 4 } };
  assert.deepEqual(
    validateContent(broken).filter((e) => e.includes('face-box')),
    [`cast ${broken.cast[0]!.id}: face-box override "fear.water" is not an overlay`],
  );
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

test('every Trait and Fear has a Rumour subject phrase', () => {
  const broken = clone(content);
  delete broken.banks.subjects['Glutton'];
  delete broken.banks.subjects['Water'];
  const errors = validateContent(broken);
  for (const key of ['Glutton', 'Water']) {
    assert.ok(errors.some((e) => e.includes('banks.subjects') && e.includes(key)), `${key}: ${errors.join('\n')}`);
  }
});

test('every Claim needs 3 phrasings that each place the {subject}', () => {
  const broken = clone(content);
  broken.banks.claims.mum.phrasings[2] = 'said his mum is cross';
  (broken.banks.claims.coup as { phrasings: string[] }).phrasings = ['said he plots with his {subject}'];
  const errors = validateContent(broken);
  assert.ok(errors.some((e) => e.includes('claims.mum') && e.includes('{subject}')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('claims.coup') && e.includes('3 phrasings')), errors.join('\n'));
});

test('the Garble ladder has 4 distinct Claims, and Garbles need absurd subjects', () => {
  const broken = clone(content);
  broken.banks.garbleLadder = ['insult', 'insult', 'coup'];
  broken.banks.absurdSubjects = {};
  const errors = validateContent(broken);
  assert.ok(errors.some((e) => e.includes('garbleLadder')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('absurdSubjects')), errors.join('\n'));
});

test('a Rumour outcome without its Template is rejected, and {claim} is only allowed where declared', () => {
  const broken = clone(content);
  broken.templates = broken.templates.filter((t) => t.id !== 'rumour.garbled');
  broken.templates[0]!.lines[0] = '{a} said {claim}.';
  const errors = validateContent(broken);
  assert.ok(errors.some((e) => e.includes('rumour.garbled')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes(broken.templates[0]!.id) && e.includes('{claim}')), errors.join('\n'));
});

// ---- Clashes and reactions (#30)

test('a fallback Clash script needs 3 lines, or 4 with a wrong saviour, and the loser speaks last', () => {
  const broken = clone(content);
  const scripts = broken.banks.clash.scripts;
  const plainKey = Object.keys(scripts).find((k) => !scripts[k]!.saviour)!;
  const saviourKey = Object.keys(scripts).find((k) => scripts[k]!.saviour)!;
  const plain = scripts[plainKey]!;
  plain.lines = [plain.lines[0]!, plain.lines[2]!, { speaker: 'winner', text: 'I win.' }];
  const saviour = scripts[saviourKey]!;
  saviour.lines = saviour.lines.filter((l) => l.speaker !== 'saviour');
  const errors = validateContent(broken);
  assert.ok(errors.some((e) => e.includes(plainKey) && e.includes('loser')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes(saviourKey) && e.includes('4 lines')), errors.join('\n'));
});

test('every Clash outcome has a fallback script, with and without a wrong saviour', () => {
  const broken = clone(content);
  for (const [key, s] of Object.entries(broken.banks.clash.scripts)) {
    if (s.outcomes.includes('fled') && s.saviour) delete broken.banks.clash.scripts[key];
  }
  const errors = validateContent(broken);
  assert.ok(errors.some((e) => e.includes('fled') && e.includes('saviour')), errors.join('\n'));
});

test('Clash scripts and results may only use the names and the magnet', () => {
  const broken = clone(content);
  const key = Object.keys(broken.banks.clash.scripts)[0]!;
  broken.banks.clash.scripts[key]!.lines[0]!.text = 'You {tag}!';
  broken.banks.clash.results.won[0] = '{ghost} won.';
  const errors = validateContent(broken);
  assert.ok(errors.some((e) => e.includes(key) && e.includes('{tag}')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('results.won') && e.includes('{ghost}')), errors.join('\n'));
});

test('Clashes need Trophies, exactly one Grudge Clash Template, and Clash Templates cast a and b', () => {
  const broken = clone(content);
  broken.banks.trophies = {};
  const grudge = broken.templates.find((t) => t.kind === 'clash' && t.trigger === 'grudge')!;
  grudge.roles = [{ name: 'x' }, { name: 'b' }];
  grudge.lines = grudge.lines.map((l) => l.replace('{a}', '{x}')) as typeof grudge.lines;
  const errors = validateContent(broken);
  assert.ok(errors.some((e) => e.includes('banks.trophies')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes(grudge.id) && e.includes('roles a and b')), errors.join('\n'));

  const none = clone(content);
  none.templates = none.templates.filter((t) => !(t.kind === 'clash' && t.trigger === 'grudge'));
  assert.ok(validateContent(none).some((e) => e.includes('Grudge Clash')), 'the Grudge roll needs its Template');
});

test("a reaction Template needs `after`, and may only cast roles its parent's kind offers", () => {
  const broken = clone(content);
  const sulk = broken.templates.find((t) => t.id === 'reaction.sulk')!;
  sulk.roles[0]!.from = 'goose';
  const moat = broken.templates.find((t) => t.id === 'reaction.moat-blame')!;
  delete moat.after;
  const errors = validateContent(broken);
  assert.ok(errors.some((e) => e.includes('reaction.sulk') && e.includes('goose')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('reaction.moat-blame') && e.includes('after')), errors.join('\n'));
});

test('every death cause tag has a Humiliation that fits it, and Humiliations only name known causes', () => {
  const broken = clone(content);
  for (const [key, h] of Object.entries(broken.banks.humiliations)) {
    if (h.causes.includes('fell')) h.causes = h.causes.filter((c) => c !== 'fell');
    if (h.causes.length === 0) delete broken.banks.humiliations[key];
  }
  broken.banks.humiliations['bandage.head']!.causes.push('exploded' as never);
  const errors = validateContent(broken);
  assert.ok(errors.some((e) => e.includes('"fell"') && e.includes('no Humiliation')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('bandage.head') && e.includes('"exploded"')), errors.join('\n'));
});

test('a deadly outcome kills a role its Template casts, with a known cause tag', () => {
  const broken = clone(content);
  const moat = broken.templates.find((t) => t.id === 'ambient.moat-dip')!;
  moat.outcomes[1]!.death = { role: 'ghost', tag: 'skewered' as never };
  const errors = validateContent(broken);
  assert.ok(errors.some((e) => e.includes('ambient.moat-dip') && e.includes('"ghost"')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('ambient.moat-dip') && e.includes('"skewered"')), errors.join('\n'));
});

test('Humiliations name real Epithets and Fears with Rumour subjects, and portrait overlays for marks', () => {
  const broken = clone(content);
  broken.banks.humiliations['epithet.the-damp']!.epithet = 'the-nonexistent';
  broken.banks.humiliations['fear.puddles']!.fear = 'Spoons';
  delete broken.banks.humiliations['lost.ear']!.overlay;
  broken.banks.humiliations['disguise.wig']!.text = 'in a wig, answering only to {nickname}';
  const errors = validateContent(broken);
  for (const [key, words] of [
    ['epithet.the-damp', 'the-nonexistent'],
    ['fear.puddles', 'Spoons'],
    ['lost.ear', 'overlay'],
    ['disguise.wig', '{nickname}'],
  ] as const) {
    assert.ok(errors.some((e) => e.includes(key) && e.includes(words)), `${key}: ${errors.join('\n')}`);
  }
});

test('the roster Templates exist, and the death bank needs sentences naming {captain}', () => {
  const broken = clone(content);
  broken.templates = broken.templates.filter((t) => t.id !== 'roster.return');
  broken.banks.death.averted.daily_cap = [];
  broken.banks.death.died[0] = 'Somebody died.';
  const errors = validateContent(broken);
  assert.ok(errors.some((e) => e.includes('roster.return')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('banks.death.averted.daily_cap')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('banks.death.died') && e.includes('{captain}')), errors.join('\n'));
});

test('Accusation lines must say the mangled {name}, and there must be a few of them', () => {
  const nameless = clone(content);
  nameless.banks.accusations[1] = 'It was him, the meddler.';
  assert.ok(validateContent(nameless).some((e) => e.includes('banks.accusations[1]') && e.includes('{name}')));
  const few = clone(content);
  few.banks.accusations = few.banks.accusations.slice(0, 2);
  assert.ok(validateContent(few).some((e) => e.includes('banks.accusations') && e.includes('at least 3')));
});

// ---- Infamy and the throne (#34)

test('outcome Infamy must go to a role the Template casts, 1–30 a time', () => {
  const broken = clone(content);
  const t = broken.templates.find((x) => x.id === 'ambient.moat-dip')!;
  t.outcomes[0]!.infamy = { ghost: 3, a: 31, b: 0 };
  const errors = validateContent(broken).filter((e) => e.includes('Infamy'));
  assert.equal(errors.length, 3, errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('"ghost"')));
});

test('the crowned Template exists, and the throne bank names {captain} in every fall and Legendary sentence', () => {
  const broken = clone(content);
  broken.templates = broken.templates.filter((t) => t.id !== 'roster.crowned');
  broken.banks.throne.fell.clash_loss = [];
  broken.banks.throne.legendary = ['Someone is Legendary.'];
  const errors = validateContent(broken);
  assert.ok(errors.some((e) => e.includes('roster.crowned')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('banks.throne.fell.clash_loss')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('banks.throne.legendary')), errors.join('\n'));
});
