import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCENTS, content } from '@orc/content';
import { castWorld, stateHash } from '@orc/sim';
import { SEEDS, T0 } from './support.ts';

const accentOf = new Map(content.cast.map((c) => [c.id, c.accent]));
const cast = (seed: number) => castWorld(content, seed, T0, []);
const active = (s: ReturnType<typeof cast>) => Object.values(s.captains).filter((c) => c.roster === 'active');

test('castWorld gives exactly 12 active Captains, Krúg among them, 2 per accent; everyone else is in reserve', () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const s = cast(seed);
    const on = active(s);
    assert.equal(on.length, 12, `seed ${seed}`);
    assert.equal(s.captains.krug?.roster, 'active', `seed ${seed}: Krúg is always active`);
    for (const accent of ACCENTS) {
      assert.equal(on.filter((c) => accentOf.get(c.id) === accent).length, 2, `seed ${seed}: ${accent}`);
    }
    const reserve = Object.values(s.captains).filter((c) => c.roster === 'reserve');
    assert.equal(reserve.length, 18, `seed ${seed}`);
    assert.equal(Object.keys(s.captains).length, 30);
  }
});

test('the highest-Power active Captain is the first Warlord, never Krúg', () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const s = cast(seed);
    const top = Math.max(...active(s).map((c) => c.power));
    const warlord = s.captains[s.world.warlordId!];
    assert.ok(warlord, `seed ${seed}: there is a Warlord`);
    assert.equal(warlord.roster, 'active');
    assert.equal(warlord.power, top, `seed ${seed}`);
    assert.notEqual(warlord.id, 'krug');
  }
});

test('different seeds cast different active 12s', () => {
  const casts = new Set<string>();
  for (let seed = 1; seed <= 20; seed++) casts.add(active(cast(seed)).map((c) => c.id).sort().join(','));
  assert.ok(casts.size > 10, `${casts.size} distinct casts`);
});

test('Traits are spread out across the active 12', () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const traits = active(cast(seed)).flatMap((c) => c.traits);
    const counts = new Map<string, number>();
    for (const t of traits) counts.set(t, (counts.get(t) ?? 0) + 1);
    assert.ok(counts.size >= 12, `seed ${seed}: only ${counts.size} distinct Traits`);
    assert.ok(Math.max(...counts.values()) <= 4, `seed ${seed}: one Trait on too many Captains`);
  }
});

test('Captains start from their cards: Power, Traits, the starting Fear, any starting Epithet, no Infamy', () => {
  const s = cast(1);
  for (const card of content.cast) {
    const c = s.captains[card.id]!;
    assert.equal(c.power, card.power);
    assert.deepEqual(c.traits, card.traits);
    assert.deepEqual(c.fears, [{ fear: card.fears[0], added: false, since: T0 }]);
    assert.equal(c.epithet, card.epithet ?? null);
    assert.equal(c.infamy, 0);
    assert.equal(c.aliasIdx, null);
    assert.equal(c.death, null);
  }
});

test('about 6 Grudges are seeded between active Captains, each with an old-history tag', () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const s = cast(seed);
    const tags = s.grudgeTags;
    assert.ok(tags.length >= 5 && tags.length <= 7, `seed ${seed}: ${tags.length} Grudges`);
    assert.equal(new Set(tags.map((t) => t.tag)).size, tags.length, 'each Grudge has its own tag');
    assert.equal(new Set(tags.map((t) => `${t.holder}>${t.toward}`)).size, tags.length, 'one Grudge per pair');
    for (const t of tags) {
      assert.ok(content.banks.oldHistory.includes(t.tag), t.tag);
      assert.notEqual(t.holder, t.toward);
      assert.equal(s.captains[t.holder]?.roster, 'active');
      assert.equal(s.captains[t.toward]?.roster, 'active');
      assert.equal(t.at, T0);
      assert.equal(t.cause, null, 'old history predates the log, so no Fact caused it');
      const value = s.affinity[`${t.holder}>${t.toward}`];
      assert.ok(value !== undefined && value < -50 && value >= -100, `affinity ${value}: below −50 so a Clash can start`);
    }
    assert.equal(Object.keys(s.affinity).length, tags.length, 'no affinity without a Grudge');
    // Seeded rows take their numbers from the sim's counter, so Facts never collide with them.
    assert.deepEqual(
      tags.map((t) => t.no),
      tags.map((_, i) => i + 1),
    );
    assert.equal(s.world.nextNo, tags.length + 1);
  }
});

test('the same seed casts the same world', () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const a = castWorld(structuredClone(content), seed, T0, ['p1']);
    const b = castWorld(structuredClone(content), seed, T0, ['p1']);
    assert.deepEqual({ ...a, content: null }, { ...b, content: null }, `seed ${seed}`);
    assert.equal(stateHash(a), stateHash(b));
  }
});

test('new Players start with 30 gold and 3 Meddles', () => {
  const s = castWorld(content, 1, T0, ['p1', 'p2']);
  assert.deepEqual(Object.keys(s.players).sort(), ['p1', 'p2']);
  for (const p of Object.values(s.players)) {
    assert.equal(p.gold, 30);
    assert.equal(p.meddles, 3);
    assert.equal(p.firstMeddleDone, false);
  }
});
