// #30 Grudge Clashes (D48): Grudges below −50 boil over into Clashes, decided by Power, Traits and luck.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, type CaptainId, type Fact, type WorldState } from '@orc/sim';
import { activeIds, addMinutes, freshWorld, SEEDS } from './support.ts';

type ClashFact = Extract<Fact, { kind: 'clash' }>;
const isClash = (f: Fact): f is ClashFact => f.kind === 'clash';

/** Two active Captains with no Trait that bends Clash odds or chances. */
function plainPair(state: WorldState, power?: [number, number]): [CaptainId, CaptainId] {
  const bends = ['Hothead', 'Coward', 'Drunkard', 'Lazy', 'Show-off'];
  const plain = activeIds(state, (id) => !state.captains[id]!.traits.some((t) => bends.includes(t)));
  if (!power) return [plain[0]!, plain[1]!];
  const a = plain.find((id) => state.captains[id]!.power === power[0]);
  const b = plain.find((id) => id !== a && state.captains[id]!.power === power[1]);
  return [a!, b!];
}

/** A world where the only feeling anyone has is `holder`'s towards `toward`, at `value`. */
function feud(value: number, opts: { seed?: number; pair?: [CaptainId, CaptainId]; reverse?: number } = {}) {
  const base = freshWorld({ seed: opts.seed ?? 1 });
  const [holder, toward] = opts.pair ?? plainPair(base);
  const affinity: WorldState['affinity'] = { [`${holder}>${toward}`]: value };
  if (opts.reverse !== undefined) affinity[`${toward}>${holder}`] = opts.reverse;
  const state: WorldState = {
    ...base,
    affinity,
    grudgeTags: [],
    world: { ...base.world, tickSeq: 1, now: addMinutes(base.world.now, 5) },
  };
  return { state, holder: holder!, toward: toward! };
}

/** The Clashes one tick produces under each of `n` tick seeds. */
function clashesOver(state: WorldState, n: number): ClashFact[] {
  const out: ClashFact[] = [];
  for (let seed = 1; seed <= n; seed++) out.push(...simulate(state, [], seed).facts.filter(isClash));
  return out;
}

test('a pair at −51 in only one direction can Clash, about 5% of ticks; a pair at −50 never does', () => {
  const n = Math.max(2000, SEEDS * 100);
  const hot = feud(-51);
  const clashes = clashesOver(hot.state, n);
  const rate = clashes.length / n;
  assert.ok(Math.abs(rate - 0.05) < 0.015, `rate ${rate}`);
  for (const c of clashes) {
    assert.equal(c.trigger, 'grudge');
    assert.deepEqual([c.a, c.b], [hot.holder, hot.toward], 'the one holding the Grudge starts it');
  }

  assert.equal(clashesOver(feud(-50).state, n).length, 0, '−50 is not below −50');
  assert.equal(clashesOver(feud(-51, { pair: [hot.toward, hot.holder] }).state, n).length > 0, true, 'either direction will do');
});
