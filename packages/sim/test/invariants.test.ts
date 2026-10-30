import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CLAIMS } from '@orc/content';
import { stateHash, type Fact, type Intent, type WorldState } from '@orc/sim';
import { activeIds, freshWorld, rumour, SEEDS, step } from './support.ts';

const PLAYERS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];

/** A deterministic stand-in for Players: each tick, each Player may submit a Rumour (debited at once, like submit_intent). */
function meddle(state: WorldState, worldSeed: number): { state: WorldState; intents: Intent[] } {
  const intents: Intent[] = [];
  const players = { ...state.players };
  for (const p of PLAYERS) {
    const roll = parseInt(createHash('sha1').update(`${worldSeed}:${state.world.tickSeq}:${p}`).digest('hex').slice(0, 8), 16);
    if (roll % 4 !== 0 || players[p]!.meddles === 0) continue;
    const active = activeIds(state);
    const source = active[roll % active.length]!;
    const target = active[(roll >>> 8) % active.length]!;
    if (source === target) continue;
    const claim = CLAIMS[(roll >>> 16) % CLAIMS.length]!;
    const subject = roll & 0x100000
      ? { from: 'fear' as const, key: state.captains[target]!.fears[0]!.fear }
      : { from: 'trait' as const, key: state.captains[target]!.traits[(roll >>> 21) & 1]! };
    const id = `${p.slice(0, 8)}-0000-4000-8000-${String(state.world.tickSeq).padStart(12, '0')}`;
    intents.push(rumour(state, p, { id, source, target, claim, subject, firstMeddle: !players[p]!.firstMeddleDone }));
    players[p] = { ...players[p]!, meddles: players[p]!.meddles - 1 };
  }
  return { state: { ...state, players }, intents };
}

function play(worldSeed: number, ticks: number) {
  let state = freshWorld({ seed: worldSeed, players: PLAYERS, now: '2026-10-30T20:00:00.000Z' });
  const facts: Fact[] = [];
  for (let i = 0; i < ticks; i++) {
    const m = meddle(state, worldSeed);
    const r = step(m.state, worldSeed, 5, m.intents);
    state = r.state;
    facts.push(...r.facts);

    for (const v of Object.values(state.affinity)) assert.ok(v >= -100 && v <= 100 && v !== 0, `affinity ${v}`);
    for (const p of Object.values(state.players)) assert.ok(p.meddles >= 0 && p.meddles <= 6, `meddles ${p.meddles}`);
    const pending = Object.keys(state.meddles);
    for (const f of r.facts) {
      const text = JSON.stringify(f);
      for (const id of pending) assert.ok(!text.includes(id), `Fact ${f.no} carries pending Meddle ${id}`);
      assert.ok(!/gold|amount|stake/i.test(Object.keys(f).join(',')), `Fact ${f.no} carries gold or a Stake`);
    }
  }
  return { state, facts, hash: stateHash(state) };
}

test('invariants hold over long runs with Players Meddling, and the same inputs replay to the same states', () => {
  let landed = 0;
  for (let worldSeed = 1; worldSeed <= SEEDS; worldSeed++) {
    const a = play(worldSeed, 300);
    landed += a.facts.filter((f) => f.kind === 'rumour').length;
    if (worldSeed <= 3) {
      const b = play(worldSeed, 300);
      assert.equal(b.hash, a.hash, `world seed ${worldSeed} replays to the same state`);
      assert.deepEqual(b.facts, a.facts, `world seed ${worldSeed} replays the same Facts`);
    }
  }
  assert.ok(landed > SEEDS * 10, `only ${landed} Rumours landed`);
});
