// #34 Infamy, the Warlord and Legendary (D42, D43, D45): Infamy comes only from stupidity, the most
// infamous orc of the week takes the throne, and 150 lifetime Infamy makes a Captain Legendary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content } from '@orc/content';
import { simulate, type CaptainId, type Fact, type WorldState } from '@orc/sim';
import { activeIds, addMinutes, freshWorld } from './support.ts';

type Of<K extends Fact['kind']> = Extract<Fact, { kind: K }>;
const ofKind = <K extends Fact['kind']>(facts: Fact[], kind: K) => facts.filter((f): f is Of<K> => f.kind === kind);
const gained = (story: Fact[], id: CaptainId) =>
  story.reduce((n, f) => n + f.infamy.filter((g) => g.captainId === id).reduce((s, g) => s + g.amount, 0), 0);

/** Four feuding pairs of plain Captains (no Trait bends a Clash), none of them the Warlord. */
function arena(patch: (s: WorldState, ids: CaptainId[]) => WorldState = (s) => s): WorldState {
  const base = freshWorld({ seed: 5 });
  const ids = activeIds(base).filter((id) => id !== base.world.warlordId).slice(0, 8);
  const captains = { ...base.captains };
  const affinity: WorldState['affinity'] = {};
  for (let i = 0; i < 8; i += 2) {
    captains[ids[i]!] = { ...captains[ids[i]!]!, power: 5, traits: ['Snob', 'Hoarder'] };
    captains[ids[i + 1]!] = { ...captains[ids[i + 1]!]!, power: 5, traits: ['Snob', 'Hoarder'] };
    affinity[`${ids[i]}>${ids[i + 1]}`] = -80;
  }
  const state: WorldState = {
    ...base,
    captains,
    affinity,
    grudgeTags: [],
    world: { ...base.world, tickSeq: 1, now: addMinutes(base.world.now, 5) },
  };
  return patch(state, ids);
}

/** Every Clash story the state makes over `n` tick seeds. */
function clashStories(state: WorldState, n: number): { head: Of<'clash'>; story: Fact[]; facts: Fact[] }[] {
  const out: { head: Of<'clash'>; story: Fact[]; facts: Fact[] }[] = [];
  for (let seed = 1; seed <= n; seed++) {
    const { facts } = simulate(state, [], seed);
    for (const head of ofKind(facts, 'clash')) out.push({ head, story: facts.filter((f) => f.storyNo === head.no), facts });
  }
  return out;
}

test('a Clash win gives 0 Infamy; losing it is stupid, and fleeing or a wrong saviour is worse', () => {
  const stories = clashStories(arena(), 300);
  assert.ok(stories.length > 30, `${stories.length} Clashes`);
  for (const { head, story } of stories) {
    assert.equal(gained(story, head.winner), 0, `Clash ${head.no}: the winner gains nothing`);
    const died = ofKind(story, 'death').length > 0;
    const loss = gained(story, head.loser) - (died ? 20 : 0) - 3 * ofKind(story, 'humiliation').length;
    const expected = head.saviour ? 18 : head.outcome === 'fled' ? 8 : 6;
    assert.equal(loss, expected, `Clash ${head.no} (${head.outcome}${head.saviour ? ', saviour' : ''}): the loser's Infamy`);
    if (head.saviour) assert.equal(gained(story, head.saviour), 3, 'the wrong saviour is mocked too');
  }
});
