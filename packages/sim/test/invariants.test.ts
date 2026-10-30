import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CLAIMS, composePortrait, content, daresFor, KRUG, LEGENDARY_LAYER, OVERLAY_LIMIT, SURPRISE } from '@orc/content';
import { fallbackDialogue, londonDate, shapeProblem, stateHash, type Fact, type Intent, type WorldState } from '@orc/sim';
import { activeIds, dare, freshWorld, rumour, SEEDS, step } from './support.ts';

const PLAYERS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];

/**
 * A deterministic stand-in for Players: each tick, each Player may submit a Rumour or a Dare (a Meddle
 * debited at once, like submit_intent), back a Captain (the gold debited at once) or withdraw a Stake.
 */
function meddle(state: WorldState, worldSeed: number): { state: WorldState; intents: Intent[] } {
  const intents: Intent[] = [];
  const players = { ...state.players };
  for (const p of PLAYERS) {
    const roll = parseInt(createHash('sha1').update(`${worldSeed}:${state.world.tickSeq}:${p}`).digest('hex').slice(0, 8), 16);
    const id = (kind: number) => `${p.slice(0, 8)}-000${kind}-4000-8000-${String(state.world.tickSeq).padStart(12, '0')}`;
    const active = activeIds(state);
    if (roll % 8 === 1 && players[p]!.meddles > 0) {
      // A Dare: one that fits him, a surprise now and then, and a victim for a Prank.
      const target = active[(roll >>> 4) % active.length]!;
      const fits = daresFor(content, state.captains[target]!);
      const dareKey = (roll >>> 12) % 5 === 0 ? SURPRISE : fits[(roll >>> 12) % fits.length]!;
      const others = active.filter((x) => x !== target);
      const victim = dareKey !== SURPRISE && content.banks.dares[dareKey]!.kind === 'prank' ? others[(roll >>> 20) % others.length] : undefined;
      intents.push(dare(state, p, { id: id(2), target, dareKey, ...(victim ? { victim } : {}), firstMeddle: !players[p]!.firstMeddleDone }));
      players[p] = { ...players[p]!, meddles: players[p]!.meddles - 1 };
      continue;
    }
    if (roll % 8 === 2 && players[p]!.gold > 0) {
      // Backing: a new Stake or a top-up, never more than he has.
      const amount = 1 + ((roll >>> 4) % Math.min(players[p]!.gold, 10));
      const captainId = active[(roll >>> 12) % active.length]!;
      intents.push({ id: id(3), playerId: p, at: state.world.now, kind: 'back', captainId, amount });
      players[p] = { ...players[p]!, gold: players[p]!.gold - amount };
      continue;
    }
    const mine = state.stakes.filter((x) => x.playerId === p);
    if (roll % 16 === 3 && mine.length > 0) {
      intents.push({ id: id(4), playerId: p, at: state.world.now, kind: 'withdraw', captainId: mine[(roll >>> 4) % mine.length]!.captainId });
      continue;
    }
    if (roll % 4 !== 0 || players[p]!.meddles === 0) continue;
    const source = active[roll % active.length]!;
    const target = active[(roll >>> 8) % active.length]!;
    if (source === target) continue;
    const claim = CLAIMS[(roll >>> 16) % CLAIMS.length]!;
    const subject = roll & 0x100000
      ? { from: 'fear' as const, key: state.captains[target]!.fears[0]!.fear }
      : { from: 'trait' as const, key: state.captains[target]!.traits[(roll >>> 21) & 1]! };
    intents.push(rumour(state, p, { id: id(1), source, target, claim, subject, firstMeddle: !players[p]!.firstMeddleDone }));
    players[p] = { ...players[p]!, meddles: players[p]!.meddles - 1 };
  }
  return { state: { ...state, players }, intents };
}

function play(worldSeed: number, ticks: number) {
  let state = freshWorld({ seed: worldSeed, players: PLAYERS, now: '2026-10-30T20:00:00.000Z' });
  const facts: Fact[] = [];
  const deathsByDay = new Map<string, number>();
  let payouts = 0;
  for (let i = 0; i < ticks; i++) {
    const m = meddle(state, worldSeed);
    const r = step(m.state, worldSeed, 5, m.intents);
    state = r.state;
    facts.push(...r.facts);
    payouts += r.diff.ledger.filter((l) => l.reason === 'payout_win' || l.reason === 'payout_infamy').length;

    // The roster (#32): always 12 active; Krúg and the Warlord are never benched; at most 3 deaths a day.
    assert.equal(activeIds(state).length, 12, `tick ${state.world.tickSeq}: the active roster is 12`);
    for (const f of r.facts) {
      if (f.kind === 'benched') {
        assert.notEqual(f.captainId, KRUG, 'Krúg is never benched');
        assert.notEqual(f.captainId, m.state.world.warlordId, 'the Warlord is never benched');
        assert.notEqual(f.captainId, state.world.warlordId, 'the Warlord is never benched');
        assert.equal(m.state.captains[f.captainId]!.legendaryFact, null, 'a Legendary Captain is never benched');
      }
      if (f.kind === 'death') {
        const day = londonDate(f.at);
        deathsByDay.set(day, (deathsByDay.get(day) ?? 0) + 1);
        assert.ok(deathsByDay.get(day)! <= 3, `${deathsByDay.get(day)} deaths on ${day}`);
      }
      if (f.kind === 'return') {
        const story = r.facts.filter((x) => x.storyNo === f.no && x.kind === 'humiliation');
        assert.equal(story.length, 1, `Return ${f.no} carries exactly one Humiliation`);
      }
    }
    // Power and Infamy (#34): Power only ever drifts by 1 (each change a `power` Fact) within 1–10; lifetime
    // Infamy grows by exactly the gains on Facts; Legendary at 150; there is always a living, active Warlord.
    for (const f of r.facts) {
      if (f.kind === 'power') assert.equal(Math.abs(f.to - f.from), 1, `power Fact ${f.no}: ${f.from} → ${f.to}`);
    }
    for (const c of Object.values(state.captains)) {
      const before = m.state.captains[c.id]!;
      const drifts = r.facts.filter((f): f is Extract<Fact, { kind: 'power' }> => f.kind === 'power' && f.captainId === c.id);
      assert.equal(c.power - before.power, drifts.reduce((n, f) => n + f.to - f.from, 0), `${c.id}: Power moves only by power Facts`);
      assert.ok(c.power >= 1 && c.power <= 10, `${c.id}: Power ${c.power}`);
      const gains = r.facts.flatMap((f) => f.infamy).filter((g) => g.captainId === c.id);
      assert.equal(c.infamy - before.infamy, gains.reduce((n, g) => n + g.amount, 0), `${c.id}: Infamy moves only by gains`);
      assert.equal(c.legendaryFact !== null, c.infamy >= 150, `${c.id}: Legendary ⇔ 150 lifetime Infamy`);
    }
    assert.equal(state.captains[state.world.warlordId!]?.roster, 'active', `tick ${state.world.tickSeq}: a living, active Warlord`);
    for (const c of Object.values(state.captains)) {
      assert.equal(c.roster === 'dead', c.death !== null && c.returnsAt !== null, `${c.id}: dead ⇔ a death and a Return time`);
      assert.ok(c.fears.length <= 3 && c.fears.some((f) => !f.added), `${c.id}: at most 3 Fears, his starting one kept`);
    }

    for (const v of Object.values(state.affinity)) assert.ok(v >= -100 && v <= 100 && v !== 0, `affinity ${v}`);
    for (const p of Object.values(state.players)) {
      assert.ok(p.meddles >= 0 && p.meddles <= 6, `meddles ${p.meddles}`);
      assert.ok(Number.isInteger(p.gold) && p.gold >= 0 && p.gold <= 30, `gold ${p.gold}`);
    }
    for (const s of state.stakes) assert.ok(Number.isInteger(s.amount) && s.amount > 0, `Stake ${s.playerId}/${s.captainId}: ${s.amount}`);
    // Portraits (#33, D60): at most 3 overlays show, the lost tusk and the Legendary stamp aside.
    for (const c of Object.values(state.captains)) {
      const marks = state.humiliations.filter((h) => h.captainId === c.id).map((h) => ({ key: h.key, no: h.no }));
      const face = composePortrait(content, { captainId: c.id, marks, legendary: c.legendaryFact !== null });
      const limited = face.layers.filter((l) => l.key !== LEGENDARY_LAYER && !content.banks.humiliations[l.key]?.overlay?.outsideLimit);
      assert.ok(limited.length <= OVERLAY_LIMIT, `${c.id}: ${limited.length} visible overlays`);
    }
    const pending = Object.keys(state.meddles);
    for (const f of r.facts) {
      const text = JSON.stringify(f);
      for (const id of pending) assert.ok(!text.includes(id), `Fact ${f.no} carries pending Meddle ${id}`);
      assert.ok(!/gold|amount|stake/i.test(Object.keys(f).join(',')), `Fact ${f.no} carries gold or a Stake`);
      if (f.kind === 'clash') {
        assert.ok(content.banks.clash.scripts[f.fallbackKey], `Clash ${f.no} has fallback key ${f.fallbackKey}`);
        assert.equal(shapeProblem(f, fallbackDialogue(content, f)), null, `Clash ${f.no}'s fallback fits its shape`);
      }
      for (const b of f.blame) assert.ok(b.hops >= 0 && b.hops <= 6, `Fact ${f.no} Blame hop ${b.hops}`);
    }
    for (const t of state.trophies) assert.ok(state.captains[t.holder] && t.holder !== t.takenFrom, `Trophy ${t.no}`);
    assert.equal(new Set(state.trophies.map((t) => t.no)).size, state.trophies.length, 'one holder per Trophy');
  }
  return { state, facts, payouts, hash: stateHash(state) };
}

test('invariants hold over long runs with Players Meddling, and the same inputs replay to the same states', () => {
  let landed = 0;
  let clashes = 0;
  let deaths = 0;
  let returns = 0;
  let drifts = 0;
  let crownings = 0;
  let dares = 0;
  let payouts = 0;
  for (let worldSeed = 1; worldSeed <= SEEDS; worldSeed++) {
    const a = play(worldSeed, 300);
    dares += a.facts.filter((f) => f.kind === 'dare').length;
    payouts += a.payouts;
    landed += a.facts.filter((f) => f.kind === 'rumour').length;
    clashes += a.facts.filter((f) => f.kind === 'clash').length;
    deaths += a.facts.filter((f) => f.kind === 'death').length;
    returns += a.facts.filter((f) => f.kind === 'return').length;
    drifts += a.facts.filter((f) => f.kind === 'power').length;
    crownings += a.facts.filter((f) => f.kind === 'crowned').length;
    if (worldSeed <= 3) {
      const b = play(worldSeed, 300);
      assert.equal(b.hash, a.hash, `world seed ${worldSeed} replays to the same state`);
      assert.deepEqual(b.facts, a.facts, `world seed ${worldSeed} replays the same Facts`);
    }
  }
  // Meddles are capped (3 a day each), and now Dares share them with Rumours.
  assert.ok(landed + dares > SEEDS * 8, `only ${landed} Rumours and ${dares} Dares landed`);
  assert.ok(clashes > SEEDS, `only ${clashes} Clashes`);
  assert.ok(deaths > SEEDS, `only ${deaths} deaths`);
  assert.ok(returns > SEEDS / 2, `only ${returns} Returns`);
  assert.ok(drifts > SEEDS, `only ${drifts} Power changes`);
  assert.ok(crownings > 0, 'no Warlord ever fell');
  assert.ok(dares > SEEDS, `only ${dares} Dares landed`);
  assert.ok(payouts > SEEDS, `only ${payouts} payouts`);
});
