import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content, swearIn } from '@orc/content';
import { dayZero, londonDate, type Fact, type FactKind, type Intent, type WorldState } from '@orc/sim';
import { activeIds, dare, rumour, SEEDS, step, T0 } from './support.ts';

// The v1 catalogue (#44) against the sim: every Fact kind is voiced, and a fresh world's day zero keeps the
// invariants with the new bundle, at the death rate the design asks for (1–3 a day, #9).

/**
 * How each Fact kind is voiced. Story heads are voiced by a Template of the same kind; consequences by a
 * sentence from a bank appended to their head's line (or nothing). Typed against `FactKind`, so a new kind
 * fails the type-check until someone decides how it's voiced.
 */
const VOICE: Record<FactKind, 'template' | 'bank' | 'silent'> = {
  incident: 'template',
  rumour: 'template',
  dare: 'template',
  clash: 'template',
  return: 'template',
  stepped_in: 'template',
  unmasked: 'template',
  crowned: 'template',
  death: 'bank',
  death_averted: 'bank',
  benched: 'bank',
  warlord_fell: 'bank',
  legendary: 'bank',
  accusation: 'bank',
  humiliation: 'bank',
  trophy: 'bank',
  humiliation_ended: 'silent',
  grudge: 'silent',
  power: 'silent',
};

const PLAYERS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const DARE_KEYS = Object.keys(content.banks.dares).sort();

/** Players Meddle on a rota: a Rumour or a Dare (every Dare in the bank in turn), when they have a Meddle. */
function meddles(state: WorldState, tick: number): { state: WorldState; intents: Intent[] } {
  const intents: Intent[] = [];
  const players = { ...state.players };
  PLAYERS.forEach((p, i) => {
    if ((tick + i) % 3 !== 0 || players[p]!.meddles === 0) return;
    const active = activeIds(state);
    const target = active[(tick * 7 + i) % active.length]!;
    const other = active[(tick * 5 + i + 1) % active.length]!;
    if (target === other) return;
    const id = `${p.slice(0, 8)}-0000-4000-8000-${String(tick).padStart(12, '0')}`;
    if (tick % 2 === 0) {
      intents.push(rumour(state, p, { id, source: other, target, claim: (['insult', 'fear', 'theft', 'mum', 'coup'] as const)[tick % 5] }));
    } else {
      const dareKey = DARE_KEYS[(tick >> 1) % DARE_KEYS.length]!;
      const prank = content.banks.dares[dareKey]!.kind === 'prank';
      intents.push(dare(state, p, { id, target, dareKey, ...(prank ? { victim: other } : {}) }));
    }
    players[p] = { ...players[p]!, meddles: players[p]!.meddles - 1 };
  });
  return { state: { ...state, players }, intents };
}

test('every Fact kind is voiced: each story head kind has a Template, each consequence a bank', () => {
  for (const [kind, voice] of Object.entries(VOICE)) {
    if (voice === 'template') assert.ok(content.templates.some((t) => t.kind === kind), `no Template of kind ${kind}`);
  }
  const b = content.banks;
  for (const [kind, bank] of [
    ['death', b.death.died],
    ['death_averted', [...b.death.averted.grace, ...b.death.averted.daily_cap]],
    ['benched', b.death.benched],
    ['warlord_fell', Object.values(b.throne.fell).flat()],
    ['legendary', b.throne.legendary],
    ['accusation', b.accusations],
    ['humiliation', Object.keys(b.humiliations)],
    ['trophy', Object.keys(b.trophies)],
  ] as const) {
    assert.equal(VOICE[kind], 'bank');
    assert.ok(bank.length > 0, `the ${kind} bank is empty`);
  }
});

test('every Fact the sim emits, with Players Meddling, is voiced: heads by a Template of their own kind', () => {
  const emitted = new Map<string, number>();
  const used = new Set<string>();
  for (let seed = 1; seed <= Math.min(30, Math.max(3, Math.ceil(SEEDS / 4))); seed++) {
    let state = dayZero(content, seed, T0, 'w', PLAYERS).state;
    const facts: Fact[] = [];
    for (let tick = 0; tick < 600; tick++) {
      const m = meddles(state, tick);
      const r = step(m.state, seed, 5, m.intents);
      state = r.state;
      facts.push(...r.facts);
    }
    for (const f of facts) {
      emitted.set(f.kind, (emitted.get(f.kind) ?? 0) + 1);
      if (f.templateId) used.add(f.templateId);
      if (f.no !== f.storyNo || VOICE[f.kind] !== 'template') continue;
      const t = content.templates.find((x) => x.id === f.templateId);
      assert.ok(t, `${f.kind} head ${f.no} has no Template (${f.templateId})`);
      assert.equal(t.kind, f.kind, `${f.kind} head ${f.no} is voiced by ${t.id}, a ${t.kind} Template`);
      assert.notEqual(f.line, '', `${f.kind} head ${f.no} has a line`);
    }
  }
  for (const kind of ['incident', 'rumour', 'dare', 'clash', 'return', 'stepped_in', 'death', 'humiliation', 'trophy']) {
    assert.ok(emitted.has(kind), `the run never emitted a ${kind} (${[...emitted.keys()].join(', ')})`);
  }
  // Every ambient Template is in rotation.
  for (const t of content.templates.filter((x) => x.trigger === 'ambient')) assert.ok(used.has(t.id), `${t.id} never ran`);
});

test('day zero with the v1 bundle keeps the invariants, prints a clean Herald, and kills 1–3 Captains a day', () => {
  // Every disaster that would kill, counted before the daily cap (3) and the grace hour turn some away.
  let attempts = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { state, steps } = dayZero(content, seed, T0, 'w');
    const facts = steps.flatMap((s) => s.facts);
    const perDay = new Map<string, number>();
    for (const f of facts) {
      if (f.kind === 'death' || f.kind === 'death_averted') attempts++;
      if (f.kind === 'death') {
        perDay.set(londonDate(f.at), (perDay.get(londonDate(f.at)) ?? 0) + 1);
      }
      // The Herald prints head lines (and the sentences appended to them). Accusations quote an orc.
      if (f.kind !== 'accusation') assert.equal(swearIn(f.line), null, `seed ${seed}: Fact ${f.no} swears: ${f.line}`);
      assert.doesNotMatch(f.line, /[{}]/, `seed ${seed}: Fact ${f.no} has an unfilled slot: ${f.line}`);
    }
    for (const [day, n] of perDay) assert.ok(n <= 3, `seed ${seed}: ${n} deaths on ${day}`);
    assert.equal(activeIds(state).length, 12, `seed ${seed}: 12 active`);
    assert.equal(state.captains[state.world.warlordId!]?.roster, 'active', `seed ${seed}: a living, active Warlord`);
    for (const c of Object.values(state.captains)) {
      assert.ok(c.power >= 1 && c.power <= 10, `seed ${seed}: ${c.id} Power ${c.power}`);
      assert.equal(c.legendaryFact !== null, c.infamy >= 150, `seed ${seed}: ${c.id} Legendary ⇔ 150 Infamy`);
    }
  }
  const mean = attempts / SEEDS;
  assert.ok(mean >= 1 && mean <= 3, `mean ${mean} deadly disasters per day zero, before the cap (target 1–3 a day)`);
});
