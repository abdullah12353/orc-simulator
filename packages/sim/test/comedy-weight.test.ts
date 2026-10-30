import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content, KRUG, type Content } from '@orc/content';
import { comedyWeight } from '@orc/sim';
import { freshWorld, run, SEEDS, step } from './support.ts';

// D50: base + Infamy/3 + 3 per Callback + 2 if Meddle-caused + 2 if Krúg or the Warlord is involved.

test('comedy weight follows the D50 formula', () => {
  const plain = { base: 4, infamy: 0, callbacks: 0, meddleCaused: false, krugOrWarlord: false };
  assert.equal(comedyWeight(plain), 4);
  assert.equal(comedyWeight({ ...plain, infamy: 9 }), 7, 'a third of the Infamy');
  assert.equal(comedyWeight({ ...plain, infamy: 11 }), 7, 'Infamy/3 rounds down');
  assert.equal(comedyWeight({ ...plain, callbacks: 2 }), 10, '3 per Callback');
  assert.equal(comedyWeight({ ...plain, meddleCaused: true }), 6, '2 if a Meddle caused it');
  assert.equal(comedyWeight({ ...plain, krugOrWarlord: true }), 6, '2 if Krúg or the Warlord is in it');
  assert.equal(
    comedyWeight({ base: 5, infamy: 30, callbacks: 1, meddleCaused: true, krugOrWarlord: true }),
    5 + 10 + 3 + 2 + 2,
  );
});

/** A bundle whose only ambient Template always casts Krúg, so we can watch the +2. */
function krugOnlyContent(): Content {
  const c = structuredClone(content);
  c.templates = [
    {
      id: 'ambient.krug-test',
      kind: 'incident',
      trigger: 'ambient',
      roles: [{ name: 'a', captain: KRUG }, { name: 'b' }],
      outcomes: [{ key: 'x', weight: 1 }],
      lines: ['{a} and {b}.', '{a} with {b}.', '{b} near {a}.'],
      baseWeight: 5,
    },
  ];
  return c;
}

test('an ambient incident with Krúg in it weighs its base + 2', () => {
  const { facts } = run(freshWorld({ content: krugOnlyContent(), watched: true }), 60);
  assert.ok(facts.length > 5);
  for (const f of facts) assert.equal(f.comedyWeight, 7, `Fact ${f.no}: ${f.line}`);
});

test("an ambient incident weighs its Template's base, +2 only when Krúg or the Warlord is in it", () => {
  let state = freshWorld({ watched: true });
  const warlord = state.world.warlordId!;
  let withVip = 0;
  let without = 0;
  for (let i = 0; i < 400; i++) {
    const r = step(state);
    for (const f of r.facts.filter((x) => x.kind === 'incident' && x.trigger === 'ambient')) {
      const base = content.templates.find((t) => t.id === f.templateId)!.baseWeight;
      const vip = f.cast.includes(KRUG) || f.cast.includes(warlord);
      assert.equal(f.comedyWeight, base + (vip ? 2 : 0), `Fact ${f.no}: ${f.cast.join(', ')}`);
      if (vip) withVip++;
      else without++;
    }
    state = r.state;
  }
  assert.ok(withVip > 0 && without > 0, `${withVip} with Krúg or the Warlord, ${without} without`);
});

test('story heads carry a comedy weight and consequences never do', () => {
  for (let worldSeed = 1; worldSeed <= SEEDS; worldSeed++) {
    const { facts } = run(freshWorld({ seed: worldSeed }), 200, worldSeed);
    for (const f of facts) {
      if (f.no === f.storyNo) assert.equal(typeof f.comedyWeight, 'number', `head ${f.no} (${f.kind})`);
      else {
        assert.equal(f.comedyWeight, undefined, `consequence ${f.no} (${f.kind}) of story ${f.storyNo}`);
        assert.ok(facts.some((h) => h.no === f.storyNo && h.no === h.storyNo), `consequence ${f.no} points at a head`);
      }
    }
  }
});
