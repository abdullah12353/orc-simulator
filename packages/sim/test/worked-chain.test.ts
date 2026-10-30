// The GDD §5 worked chain, end to end (spec Seam A; user story 86): Mohammed backs Krúg and plants a Rumour
// that misfires onto Lord Snarlbottom; the Grudge boils over into a Clash a wrong saviour makes worse; Krúg
// loses and dies, Snarlbottom takes a Trophy, Mohammed's Backing pays out on the Infamy; Krúg Returns
// Humiliated; the Warlord falls and Krúg, the most infamous orc of the week, takes the throne. Mohammed's
// Blame follows the whole way: Rumour → Grudge → Clash → death → Return → coup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content as shipped, KRUG, type Content } from '@orc/content';
import { applyDiff, simulate, type CaptainId, type Fact, type Intent, type StateDiff, type WorldState } from '@orc/sim';
import { activeIds, addMinutes, dare, freshWorld, rumour } from './support.ts';

const MOHAMMED = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SNARLBOTTOM = 'snarlbottom';
const GRISHNACK = 'grishnack';

type Of<K extends Fact['kind']> = Extract<Fact, { kind: K }>;
const ofKind = <K extends Fact['kind']>(facts: Fact[], kind: K) => facts.filter((f): f is Of<K> => f.kind === kind);
const one = <K extends Fact['kind']>(facts: Fact[], kind: K): Of<K> => {
  const [f] = ofKind(facts, kind);
  assert.ok(f, `a ${kind} Fact`);
  return f;
};
/** Who is to blame for a Fact, and how many hops away: [Player, verb, hops]. */
const blameOf = (f: Fact) => f.blame.map((b) => [b.playerId, b.verb, b.hops]);

/** No ambient incidents and no reactions: only what the Meddles and the Grudge set off. */
function quiet(): Content {
  const c = structuredClone(shipped);
  c.templates = c.templates.filter((t) => t.trigger !== 'ambient' && t.trigger !== 'reaction');
  return c;
}

/** One tick at `now`, under the first tick seed that plays out `want`. */
function tickUntil(state: WorldState, now: string, intents: Intent[], want: (facts: Fact[], diff: StateDiff) => boolean) {
  const input: WorldState = { ...state, world: { ...state.world, tickSeq: state.world.tickSeq + 1, prevTickAt: state.world.now, now } };
  for (let seed = 1; seed <= 20_000; seed++) {
    const r = simulate(input, intents, seed);
    if (want(r.facts, r.stateDiff)) return { facts: r.facts, diff: r.stateDiff, state: applyDiff(input, r.stateDiff) };
  }
  throw new Error('no tick seed plays this step out');
}

/**
 * The fortress of the worked example: Krúg (Power 3, Mummy's Boy and Little Fortresser, afraid of Water),
 * Grishnack and Lord Snarlbottom active, Snarlbottom sharing the Trait the Rumour is about (he really is
 * wearing the bucket), and a Glutton about. Nobody has done anything stupid this week yet.
 */
function fortress(): WorldState {
  const base = freshWorld({ content: quiet(), players: [MOHAMMED, OTHER] });
  const warlord = activeIds(base).find((id) => ![KRUG, SNARLBOTTOM, GRISHNACK].includes(id))!;
  const keep = [KRUG, SNARLBOTTOM, GRISHNACK, warlord];
  const others = Object.keys(base.captains)
    .sort()
    .filter((id) => !keep.includes(id) && base.captains[id]!.roster === 'active');
  const active = new Set([...keep, ...others].slice(0, 12));
  const captains = { ...base.captains };
  for (const id of Object.keys(captains)) {
    captains[id] = { ...captains[id]!, roster: active.has(id) ? 'active' : 'reserve', infamy: 0, graceUntil: null };
  }
  captains[KRUG] = { ...captains[KRUG]!, power: 3, traits: ["Mummy's Boy", 'Little Fortresser'], fears: [{ fear: 'Water', added: false, since: base.world.now }] };
  captains[GRISHNACK] = { ...captains[GRISHNACK]!, traits: ['Vain', 'Snob'] };
  captains[SNARLBOTTOM] = { ...captains[SNARLBOTTOM]!, power: 6, traits: ['Vain', 'Hoarder'] };
  const glutton = [...active].find((id) => !keep.includes(id))!;
  captains[glutton] = { ...captains[glutton]!, traits: ['Glutton', 'Lazy'] };
  return {
    ...base,
    captains,
    // Snarlbottom already isn't fond of Krúg; a Rumour will tip him over.
    affinity: { [`${SNARLBOTTOM}>${KRUG}`]: -40 },
    grudgeTags: [],
    world: { ...base.world, warlordId: warlord },
  };
}

test('the GDD §5 worked chain plays out end to end, with Blame at the expected hops', () => {
  let state = fortress();
  const warlord = state.world.warlordId!;
  assert.notEqual(warlord, KRUG);

  // 1–2. Mohammed backs Krúg and plants a Rumour: "Krúg says Grishnack's helmet is a bucket."
  const stake = 10;
  state = { ...state, players: { ...state.players, [MOHAMMED]: { ...state.players[MOHAMMED]!, gold: state.players[MOHAMMED]!.gold - stake } } };
  const back: Intent = { id: '00000000-0000-4000-8000-0000000000b1', playerId: MOHAMMED, at: state.world.now, kind: 'back', captainId: KRUG, amount: stake };
  const plant = rumour(state, MOHAMMED, { source: KRUG, target: GRISHNACK, claim: 'insult', subject: { from: 'trait', key: 'Vain' } });
  let t = tickUntil(state, addMinutes(state.world.now, 5), [back, plant], () => true);
  assert.deepEqual(t.diff.intents.map((i) => i.status), ['consumed', 'consumed']);
  state = t.state;

  // It misfires onto Snarlbottom, who now holds a Grudge against Krúg.
  t = tickUntil(state, state.fuses[0]!.dueAt, [], (facts) => ofKind(facts, 'rumour')[0]?.reached === SNARLBOTTOM && ofKind(facts, 'clash').length === 0);
  const rumourHead = one(t.facts, 'rumour');
  assert.equal(rumourHead.outcome, 'wrong_orc');
  assert.deepEqual(blameOf(rumourHead), [[MOHAMMED, 'rumour', 0]]);
  state = t.state;
  assert.ok(state.affinity[`${SNARLBOTTOM}>${KRUG}`]! < -50, 'below −50: a Clash is possible');
  const tag = state.grudgeTags.find((g) => g.holder === SNARLBOTTOM && g.toward === KRUG)!;
  assert.equal(tag.cause?.fact, rumourHead.no);

  // 4–6. The Grudge boils over; a wrong saviour barges in; Krúg loses and dies; Snarlbottom takes a Trophy.
  t = tickUntil(state, addMinutes(state.world.now, 5), [], (facts) => {
    const c = ofKind(facts, 'clash')[0];
    return !!c && c.a === SNARLBOTTOM && c.loser === KRUG && !!c.saviour && ofKind(facts, 'death').some((d) => d.captainId === KRUG) && ofKind(facts, 'trophy').length > 0;
  });
  const clash = one(t.facts, 'clash');
  const death = one(t.facts, 'death');
  const trophy = one(t.facts, 'trophy');
  assert.deepEqual(clash.causes, [rumourHead.no], 'the Clash required the Grudge the Rumour planted');
  assert.deepEqual(blameOf(clash), [[MOHAMMED, 'rumour', 1]]);
  assert.deepEqual(blameOf(death), [[MOHAMMED, 'rumour', 2]]);
  assert.deepEqual([trophy.to, trophy.from], [SNARLBOTTOM, KRUG]);
  assert.deepEqual(blameOf(trophy), [[MOHAMMED, 'rumour', 2]]);
  const krugInfamy = t.facts.flatMap((f) => f.infamy).filter((g) => g.captainId === KRUG).reduce((n, g) => n + g.amount, 0);
  assert.ok(krugInfamy >= 30, `Krúg's disaster is worth ${krugInfamy} Infamy`);
  const payout = t.diff.ledger.find((l) => l.playerId === MOHAMMED && l.reason === 'payout_infamy');
  assert.ok(payout && payout.delta > 0 && payout.fact === clash.no, "Mohammed's Backing pays out on the Infamy");
  state = t.state;
  assert.equal(state.captains[KRUG]!.roster, 'dead');

  // 7. Krúg Returns, Humiliated. Another Player dares the Warlord to do something stupid on the throne.
  const dared = dare(state, OTHER, { target: warlord, dareKey: 'stunt.torches' });
  t = tickUntil(state, state.captains[KRUG]!.returnsAt!, [dared], (facts) => ofKind(facts, 'return').length === 1);
  const ret = one(t.facts, 'return');
  assert.equal(ret.intro.captainId, KRUG);
  assert.deepEqual(ret.causes, [death.no], 'his death is what the Return required');
  assert.deepEqual(blameOf(ret), [[MOHAMMED, 'rumour', 3]]);
  const humiliation = one(t.facts.filter((f) => f.storyNo === ret.no), 'humiliation');
  assert.deepEqual(blameOf(humiliation), [[MOHAMMED, 'rumour', 4]]);
  state = t.state;

  // 8. The Warlord botches it and falls off the throne. Succession by Infamy: Krúg is Warlord.
  const dareFuse = state.fuses.find((f) => f.meddleId === dared.id)!;
  t = tickUntil(state, dareFuse.dueAt, [], (facts) => ofKind(facts, 'warlord_fell').length === 1);
  const fell = one(t.facts, 'warlord_fell');
  assert.equal(fell.captainId, warlord);
  const crowned = one(t.facts, 'crowned');
  assert.equal(crowned.intro.captainId, KRUG, 'the most infamous orc of the week takes the throne');
  assert.equal(crowned.previous, warlord);
  assert.equal(t.state.world.warlordId, KRUG);
  // The coup required the empty throne (the other Player's Dare) and what won it: Krúg's week of disasters,
  // down to the Humiliation he came back with. So Mohammed's Rumour is to blame for it, 5 hops on.
  assert.deepEqual(blameOf(crowned), [
    [MOHAMMED, 'rumour', 5],
    [OTHER, 'dare', 2],
  ]);
});
