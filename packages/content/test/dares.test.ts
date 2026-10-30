import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content, dareFits, dareOffers, playsOnFear, validateContent, type Content } from '@orc/content';

// The Dare picker (#35, user stories 42–45): 3 Dares at a time from the tagged bank, plus "surprise".

const clone = (): Content => structuredClone(content);

test('the picker always offers 3 distinct Dares that fit the chosen target, a Stunt and a Prank among them', () => {
  for (const card of content.cast) {
    const target = { id: card.id, traits: card.traits };
    const seen = new Set<string>();
    for (let round = 0; round < 12; round++) {
      const offers = dareOffers(content, target, round);
      assert.equal(offers.length, 3, `${card.id} round ${round}`);
      assert.equal(new Set(offers).size, 3, 'distinct');
      for (const key of offers) {
        const def = content.banks.dares[key];
        assert.ok(def, `${key} is in the bank`);
        assert.ok(dareFits(def, target), `${key} fits ${card.id}`);
        seen.add(key);
      }
      const kinds = new Set(offers.map((k) => content.banks.dares[k]!.kind));
      assert.deepEqual([...kinds].sort(), ['prank', 'stunt'], `${card.id} round ${round}: ${offers.join(', ')}`);
      assert.deepEqual(dareOffers(content, target, round), offers, 'the same round offers the same 3');
    }
    assert.ok(seen.size > 6, `asking again shows other Dares (${card.id} saw ${seen.size})`);
  }
});

test('a Dare that needs a Trait is only offered to a Captain who has it', () => {
  const needy = Object.entries(content.banks.dares).filter(([, d]) => d.needs);
  assert.ok(needy.length > 0, 'the bank has Trait-only Dares');
  for (const [key, def] of needy) {
    assert.equal(dareFits(def, { traits: ['Glutton', 'Vain'].filter((t) => t !== def.needs) }), false);
    assert.equal(dareFits(def, { traits: [def.needs!] }), true);
    for (const card of content.cast.filter((c) => !c.traits.includes(def.needs!))) {
      for (let round = 0; round < 12; round++) {
        assert.ok(!dareOffers(content, { id: card.id, traits: card.traits }, round).includes(key));
      }
    }
  }
});

test('a Dare plays on a Fear when one of its tags is a Fear the target has', () => {
  const [key, def] = Object.entries(content.banks.dares).find(([, d]) => d.tags.includes('Heights'))!;
  assert.ok(key);
  assert.equal(playsOnFear(def, ['Heights']), true);
  assert.equal(playsOnFear(def, ['Soap']), false);
  assert.equal(playsOnFear(def, []), false);
});

test('the Dare bank is validated: tags, prank Grudges, Trait needs, and enough Dares of each kind', () => {
  assert.deepEqual(validateContent(content), []);
  assert.ok(Object.keys(content.banks.dares).length >= 12, 'a placeholder subset of the ~35');

  const c = clone();
  c.banks.dares['stunt.bad'] = { kind: 'stunt', label: 'Bad', text: 'do a bad thing', tags: ['Unicorns'], needs: 'Tall' };
  c.banks.dares['prank.bad'] = { kind: 'prank', label: 'Bad prank', text: 'annoy someone', tags: [] };
  const errors = validateContent(c);
  assert.ok(errors.some((e) => e.includes('stunt.bad') && e.includes('"Unicorns"')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('stunt.bad') && e.includes('"Tall"')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('prank.bad') && e.includes('{victim}')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('prank.bad') && e.includes('grudge')), errors.join('\n'));

  const few = clone();
  for (const key of Object.keys(few.banks.dares)) if (few.banks.dares[key]!.kind === 'prank') delete few.banks.dares[key];
  assert.ok(validateContent(few).some((e) => e.startsWith('banks.dares') && e.includes('prank')));
});

test('every Dare outcome has its Template, and a botched Dare has Humiliations that fit it', () => {
  const c = clone();
  c.templates = c.templates.filter((t) => t.id !== 'dare.prank.refused');
  assert.ok(validateContent(c).some((e) => e.includes('dare.prank.refused')));
  assert.ok(Object.values(content.banks.humiliations).filter((h) => h.causes.includes('botched')).length >= 3);
});
