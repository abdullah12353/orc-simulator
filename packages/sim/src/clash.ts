// Clashes (D48, #15): only Grudges start them (affinity below −50 in either direction, about 5% a tick),
// or a forcing reaction (a Hothead hearing a Rumour). Odds are logistic on Power, shifted by Traits and
// each side's Backing edge. Outcomes are won, defeated or, for a Coward, fled. A wrong saviour crashes in
// about 1 Clash in 5, and the winner takes a Trophy in about half of defeats.
//
// The seam for later tickets: `resolveClash` writes the head, then its consequences in order (the death
// roll last). The loser's Infamy and a Warlord's fall (#34) go on the head; payouts (#36) join
// `consequences`; the Backing edge (#36) is `backingEdge`, and payouts happen at the end of the tick
// (`settleBacking` in backing.ts reads every Clash head's winner and every Fact's Infamy).
import type { ClashOutcome, TemplateDef } from '@orc/content';
import { backersOf, edgeFor } from './backing.ts';
import { pairOf, type TickContext } from './context.ts';
import { causeOf } from './blame.ts';
import { holdGrudge } from './grudge.ts';
import { drift, gainInfamy, INFAMY, warlordFalls } from './infamy.ts';
import { followUp } from './reactions.ts';
import { disaster, maybeUnmask, UNMASK } from './roster.ts';
import { renderLine } from './rumours.ts';
import type { CaptainId, Cause, ClashFact, GrudgeTag, Trophy } from './types.ts';

export const CLASH = {
  /** A pair Clashes only when a direction is strictly below this. */
  threshold: -50,
  /** Chance per tick for each pair below the threshold. */
  chance: 0.05,
  /** Added when the one holding the Grudge is a Hothead. */
  hotheadChance: 0.05,
  /** Logistic slope on the Power gap: a Power 3 beats a Power 7 about 1 time in 5 (ln 4 / 4). */
  powerSlope: Math.log(4) / 4,
  /** Trait shifts to a Captain's own odds. */
  traitShift: { Hothead: 0.05, 'Show-off': -0.03, Drunkard: -0.05, Lazy: -0.05 } as Record<string, number>,
  /** The final odds never go past these. */
  oddsFloor: 0.05,
  oddsCeiling: 0.95,
  /** Chance a Coward who is losing runs instead. */
  cowardFlees: 0.6,
  /** A wrong saviour crashes in about 1 Clash in 5. */
  saviour: 0.2,
  /** A Captain with a magnet Trait is this much likelier to be the wrong saviour. */
  magnetWeight: 3,
  /** The winner takes a Trophy in about half of defeats (never when the loser fled). */
  trophy: 0.5,
  /** When the loser holds Trophies, the chance the winner takes one of those instead of a new one. */
  retake: 0.5,
  /** A Clash lets off steam: every direction of the pair below the threshold rises by this… */
  vent: 25,
  /** …then the loser's feeling towards the winner drops by this, with a new Grudge tag. */
  sting: 15,
  /** And his feeling towards a wrong saviour drops by this. */
  saviourSting: 10,
  /** How many of the pair's newest Grudge tags the Fact carries for narration. */
  topTags: 3,
  /**
   * A Clash defeat kills 1 time in 5; a loser who fled lives. Tuned in #44 for about 1–3 deaths a day (D40):
   * day zero's old Grudges burn out in ~11 Clashes, so 1 in 3 made ~3.8 deadly disasters before the cap.
   */
  death: 1 / 5,
} as const;

export interface ClashStart {
  template: TemplateDef;
  /** The one who starts it (holds the Grudge, or reacts). */
  a: CaptainId;
  b: CaptainId;
  trigger: ClashFact['trigger'];
  /** What the Clash required: the pair's Grudge tags, or the parent Fact of a forcing reaction. */
  requires: Cause[];
  /** Reaction depth of this Clash in the tick (0 for a Grudge roll). */
  depth: number;
}

/**
 * The Grudge roll: each pair of active Captains with affinity below −50 in either direction, in key order,
 * Clashes with about 5% chance. The one with the deeper Grudge starts it (slug order on a tie).
 */
export function rollGrudgeClashes(ctx: TickContext): void {
  const template = ctx.state.content.templates.find((t) => t.kind === 'clash' && t.trigger === 'grudge');
  if (!template) return;
  const active = new Set(ctx.activeCaptains());
  const pairs = new Map<string, [CaptainId, CaptainId]>();
  for (const [holder, toward] of ctx.affinityPairs()) {
    if (!active.has(holder) || !active.has(toward)) continue;
    if (ctx.getAffinity(holder, toward) >= CLASH.threshold) continue;
    pairs.set(pairOf(holder, toward), holder < toward ? [holder, toward] : [toward, holder]);
  }
  for (const key of [...pairs.keys()].sort()) {
    if (ctx.clashedPairs.has(key)) continue;
    const [x, y] = pairs.get(key)!;
    // An earlier Clash this tick may have killed one of them.
    if (ctx.rosterOf(x) !== 'active' || ctx.rosterOf(y) !== 'active') continue;
    const [a, b] = ctx.getAffinity(y, x) < ctx.getAffinity(x, y) ? [y, x] : [x, y];
    // An earlier Clash this tick (or what it set off) may have vented this pair since the list was made.
    if (ctx.getAffinity(a, b) >= CLASH.threshold) continue;
    const hothead = ctx.state.captains[a]!.traits.includes('Hothead') ? CLASH.hotheadChance : 0;
    if (!ctx.rng.chance(CLASH.chance + hothead)) continue;
    const requires = [
      ...(ctx.getAffinity(a, b) < CLASH.threshold ? ctx.pairCauses(a, b) : []),
      ...(ctx.getAffinity(b, a) < CLASH.threshold ? ctx.pairCauses(b, a) : []),
    ];
    resolveClash(ctx, { template, a, b, trigger: 'grudge', requires, depth: 0 });
  }
}

/** a's chance to win before Backing: logistic on the Power gap, plus each side's Trait shifts. */
export function powerOdds(ctx: TickContext, a: CaptainId, b: CaptainId): number {
  const ca = ctx.captain(a);
  const cb = ctx.captain(b);
  const shift = (traits: readonly string[]) => traits.reduce((s, t) => s + (CLASH.traitShift[t] ?? 0), 0);
  const p = 1 / (1 + Math.exp(-CLASH.powerSlope * (ca.power - cb.power))) + shift(ca.traits) - shift(cb.traits);
  return round3(clamp(p));
}

/** A Captain's Backing edge in a Clash (#36): +5% per backer, at most +10%, whatever the Stakes. */
export function backingEdge(ctx: TickContext, captainId: CaptainId): number {
  return edgeFor(backersOf(ctx, captainId).length);
}

/** Resolves one Clash: the head, its consequences, and then whatever reacts to it. Returns the head. */
export function resolveClash(ctx: TickContext, start: ClashStart): ClashFact {
  const { state, rng } = ctx;
  const { a, b, template } = start;
  ctx.clashedPairs.add(pairOf(a, b));

  const pA = powerOdds(ctx, a, b);
  const powers = { [a]: ctx.captain(a).power, [b]: ctx.captain(b).power };
  const edgeA = backingEdge(ctx, a);
  const edgeB = backingEdge(ctx, b);
  const aWins = rng.next() < clamp(pA + edgeA - edgeB);
  const [winner, loser] = aWins ? [a, b] : [b, a];
  const fled = ctx.captain(loser).traits.includes('Coward') && rng.chance(CLASH.cowardFlees);
  const outcome: ClashOutcome = fled ? 'fled' : aWins ? 'won' : 'defeated';
  const saviour = rng.chance(CLASH.saviour) ? pickSaviour(ctx, a, b) : null;

  const scripts = state.content.banks.clash.scripts;
  const fitting = Object.keys(scripts)
    .sort()
    .filter((k) => scripts[k]!.saviour === (saviour !== null) && scripts[k]!.outcomes.includes(outcome));
  const fallbackKey = rng.pick(fitting);
  const variant = rng.int(3) as 0 | 1 | 2;

  const no = ctx.allocNo();
  const tags = pairTags(ctx, a, b);
  const named = tags.find((t) => t.holder === a && t.toward === b);
  // Naming a Grudge tag the world already remembered (from before this tick) is a Callback (D50).
  const remembered = named && ctx.state.grudgeTags.some((t) => t.no === named.no) ? [named] : [];
  const { causes, blame } = ctx.link(no, { requires: start.requires, callbacks: remembered });
  const results = state.content.banks.clash.results;
  const names = { winner, loser, ...(saviour ? { saviour: saviour.id } : {}) };
  const magnet = { magnet: saviour?.magnet ?? '' };
  const result =
    renderLine(ctx, results[outcome][variant], names, magnet) +
    (saviour ? ` ${renderLine(ctx, results.saviour[variant], names, magnet)}` : '');
  const tag = named?.tag ?? state.content.banks.clash.noTag;

  const head: ClashFact = {
    no,
    at: state.world.now,
    storyNo: no,
    templateId: template.id,
    variant,
    line: renderLine(ctx, template.lines[variant], { a, b }, { tag, result }),
    tier: 'templated',
    cast: saviour ? [a, b, saviour.id] : [a, b],
    causes,
    blame,
    infamy: [],
    kind: 'clash',
    a,
    b,
    trigger: start.trigger,
    pA,
    edgeA,
    edgeB,
    outcome,
    winner,
    loser,
    ...(saviour ? { saviour: saviour.id, saviourMagnet: saviour.magnet } : {}),
    topTags: tags.slice(0, CLASH.topTags).map((t) => t.tag),
    fallbackKey,
  };
  ctx.facts.push(head);
  ctx.misfortune(loser, head);
  // Losing is stupid (a win earns nothing, D42); a wrong saviour makes it a disaster, and looks daft himself.
  gainInfamy(ctx, head, loser, saviour ? INFAMY.clash.withSaviour : fled ? INFAMY.clash.fled : INFAMY.clash.lost);
  if (saviour) gainInfamy(ctx, head, saviour.id, INFAMY.clash.saviour);
  // A Warlord who loses any Clash, fled or not, loses the throne (D43).
  warlordFalls(ctx, head, loser, 'clash_loss');
  consequences(ctx, head, powers, start.depth);
  followUp(ctx, head, start.depth);
  return head;
}

/**
 * What a Clash leaves behind, in order: the Grudge lets off steam, the winner may take a Trophy, the
 * loser holds a new Grudge against the winner (and against a wrong saviour), a winner who beat someone
 * stronger gains a point of Power, and the loser may die. Each requires the head.
 */
function consequences(ctx: TickContext, head: ClashFact, powers: Record<CaptainId, number>, depth: number): void {
  const { state, rng } = ctx;
  const { a, b, winner, loser } = head;
  const headCause: Cause = causeOf(head);
  const bank = state.content.banks.clash;

  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    const v = ctx.getAffinity(x, y);
    if (v < CLASH.threshold) ctx.setAffinity(x, y, v + CLASH.vent);
  }

  let trophyText: string | null = null;
  if (head.outcome !== 'fled' && rng.chance(CLASH.trophy)) {
    trophyText = takeTrophy(ctx, head, headCause);
  }

  const tag =
    trophyText !== null
      ? bank.tags.trophy.replace('{trophy}', trophyText)
      : rng.pick(head.outcome === 'fled' ? bank.tags.fled : bank.tags.beaten);
  holdGrudge(ctx, head, { holder: loser, toward: winner, sting: CLASH.sting, tag });
  if (head.saviour) {
    const tag = bank.tags.saviour.replace('{magnet}', head.saviourMagnet ?? bank.anyMagnet);
    holdGrudge(ctx, head, { holder: loser, toward: head.saviour, sting: CLASH.saviourSting, tag });
  }

  // Beating a stronger Captain makes him stronger (D42), as Power stood when they squared up.
  if (powers[winner]! < powers[loser]!) drift(ctx, head, winner, 1);

  // The loser may die (or be Humiliated instead, at the cap or in grace); a disguised survivor may be Unmasked.
  if (head.outcome !== 'fled' && rng.chance(CLASH.death)) disaster(ctx, head, loser, 'beaten', depth);
  else maybeUnmask(ctx, head, loser, 'clash', UNMASK.clash, depth);
}

/** The winner takes one of the loser's Trophies, or a new one from the bank. Returns its text. */
function takeTrophy(ctx: TickContext, head: ClashFact, headCause: Cause): string {
  const { state, rng } = ctx;
  const { winner, loser } = head;
  const bank = state.content.banks.trophies;
  const held = ctx.trophies().filter((t) => t.holder === loser);
  const no = ctx.allocNo();
  let trophy: Trophy;
  const retaken = held.length > 0 && rng.chance(CLASH.retake) ? rng.pick(held) : null;
  const callbacks: Cause[] = retaken ? [retaken.origin] : [];
  const { causes, blame } = ctx.link(no, { requires: [headCause], callbacks });
  if (retaken) {
    trophy = { ...retaken, holder: winner, takenFrom: loser, origin: { fact: no, blame } };
  } else {
    const owned = new Set(ctx.trophies().filter((t) => t.holder === winner).map((t) => t.key));
    const keys = Object.keys(bank).sort();
    const fresh = keys.filter((k) => !owned.has(k));
    trophy = { no: ctx.allocNo(), key: rng.pick(fresh.length > 0 ? fresh : keys), holder: winner, takenFrom: loser, origin: { fact: no, blame } };
  }
  ctx.upsertTrophy(trophy);
  ctx.facts.push({
    no,
    at: state.world.now,
    storyNo: head.no,
    line: '',
    tier: 'silent',
    cast: [winner, loser],
    causes,
    blame,
    infamy: [],
    kind: 'trophy',
    trophy: trophy.no,
    key: trophy.key,
    from: loser,
    to: winner,
  });
  return bank[trophy.key]?.text ?? trophy.key;
}

/** A third active Captain, drawn in by a Trait magnet (a Glutton by the pies) or, failing that, the noise. */
function pickSaviour(ctx: TickContext, a: CaptainId, b: CaptainId): { id: CaptainId; magnet: string } | null {
  const bank = ctx.state.content.banks.clash;
  const magnetOf = (id: CaptainId) => ctx.state.captains[id]!.traits.map((t) => bank.magnets[t]).find((m) => m !== undefined);
  const candidates = ctx.activeCaptains().filter((id) => id !== a && id !== b);
  if (candidates.length === 0) return null;
  const id = ctx.rng.weighted(candidates, (c) => (magnetOf(c) ? CLASH.magnetWeight : 1));
  return { id, magnet: magnetOf(id) ?? bank.anyMagnet };
}

/** The pair's Grudge tags in both directions, newest first (this tick's included). */
function pairTags(ctx: TickContext, a: CaptainId, b: CaptainId): GrudgeTag[] {
  return [...ctx.state.grudgeTags, ...ctx.diff.grudgeTags]
    .filter((t) => (t.holder === a && t.toward === b) || (t.holder === b && t.toward === a))
    .sort((x, y) => y.no - x.no);
}

const clamp = (p: number) => Math.max(CLASH.oddsFloor, Math.min(CLASH.oddsCeiling, p));
// Rounded so the stored odds (and the roll against them) don't depend on the last bits of Math.exp.
const round3 = (p: number) => Math.round(p * 1000) / 1000;
