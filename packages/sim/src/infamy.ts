// Infamy, Power, the Warlord and Legendary (#34; Failing Upward #9: D42, D43, D45). Infamy comes only from
// stupidity, in tiers, and is lifetime; the most infamous orc of the last 7 days takes the throne whenever
// the Warlord falls (any death, Clash loss or botched Dare); 150 lifetime Infamy makes a Captain Legendary,
// for good. Power only ever drifts by 1: down on a death, up for beating someone stronger.
//
// The seams:
// - `gainInfamy(ctx, fact, id, amount)`: the ONE way to give Infamy. It goes on the Fact's `infamy` (so
//   comedy weight, `infamy_gains` and payouts see it), into the 7-day window and the lifetime total, and
//   writes the `legendary` Fact when it takes him over 150.
// - `warlordFalls(ctx, fact, id, why)`: call it whenever `id` dies, loses a Clash or botches a Dare (a no-op
//   unless he is the Warlord). The throne stays empty until `crownSuccessor` runs at the end of the tick.
// - `drift(ctx, fact, id, delta)`: the ONE way to change Power (±1, kept within 1–10), with a `power` Fact.
import { ROSTER_TEMPLATES, type OutcomeDef } from '@orc/content';
import type { TickContext } from './context.ts';
import { followUp } from './reactions.ts';
import { renderLine } from './rumours.ts';
import type { CaptainId, Cause, Fact } from './types.ts';

/**
 * Infamy per stupidity (D42): silent 1–4 (mocked, a small mishap), notable 5–15 (a Clash lost, a refused
 * Dare, a Rumour backfiring on its supposed source), disaster 15–30 (a death, a botched Dare, losing with a
 * wrong saviour's help). A win earns 0; the throne +20. Ambient incidents carry their own (`OutcomeDef.infamy`).
 */
export const INFAMY = {
  clash: {
    /** Losing a Clash (the loser stays to be beaten). */
    lost: 6,
    /** Running away from one (a Coward). */
    fled: 8,
    /** Losing one a wrong saviour barged into: disaster tier. */
    withSaviour: 18,
    /** The wrong saviour himself is mocked for it. */
    saviour: 3,
  },
  /** Dying (any disaster). */
  death: 20,
  /** Each Humiliation gained (on a Return or a death averted). */
  humiliation: 3,
  /** Being exposed in disguise. */
  unmasked: 8,
  /** A landed Rumour backfires on its supposed source: everyone thinks he said it. */
  rumourSource: 5,
  /** Dares (#35 uses these through `gainInfamy`). */
  dare: { pulledOff: 5, refused: 8, botched: 20 },
  /** Taking the throne. */
  throne: 20,
  /** Lifetime Infamy that makes a Captain Legendary (D45). */
  legendary: 150,
  /** A crowning requires the Facts behind the successor's newest this-many gains in the 7-day window. */
  standingGains: 3,
} as const;

/** Power runs 1–10 and only ever moves by 1 (D42). */
export const POWER = { min: 1, max: 10 } as const;

export type FallWhy = Extract<Fact, { kind: 'warlord_fell' }>['why'];

const causeOf = (f: Fact): Cause => ({ fact: f.no, blame: f.blame });

/** The story head `fact` belongs to (itself, for a head). Heads are always written before their consequences. */
function headOf(ctx: TickContext, fact: Fact): Fact {
  return fact.no === fact.storyNo ? fact : (ctx.facts.find((f) => f.no === fact.storyNo) ?? fact);
}

/**
 * Gives `id` Infamy for `fact` (already written, or about to be: it must be in `ctx.facts` by the end of
 * the tick). Lifetime and 7-day totals move together; crossing 150 writes his Legendary deed, once ever.
 */
export function gainInfamy(ctx: TickContext, fact: Fact, id: CaptainId, amount: number): void {
  if (amount <= 0 || !ctx.state.captains[id]) return;
  const mine = fact.infamy.find((g) => g.captainId === id);
  if (mine) mine.amount += amount;
  else fact.infamy.push({ captainId: id, amount });
  // One row per (Fact, Captain), like `infamy_gains`.
  const row = ctx.diff.infamy.find((g) => g.fact === fact.no && g.captainId === id);
  if (row) row.amount += amount;
  else ctx.diff.infamy.push({ captainId: id, fact: fact.no, at: fact.at, amount });

  const before = ctx.captain(id);
  const infamy = before.infamy + amount;
  ctx.patchCaptain(id, { infamy });
  if (before.legendaryFact === null && before.infamy < INFAMY.legendary && infamy >= INFAMY.legendary) {
    becomeLegendary(ctx, headOf(ctx, fact), id);
  }
}

/** An incident outcome's own Infamy (`OutcomeDef.infamy`) for the Captains cast in its roles, in role order. */
export function outcomeInfamy(ctx: TickContext, fact: Fact, outcome: OutcomeDef, cast: Record<string, CaptainId>): void {
  for (const role of Object.keys(outcome.infamy ?? {}).sort()) {
    const id = cast[role];
    if (id !== undefined) gainInfamy(ctx, fact, id, outcome.infamy![role]!);
  }
}

/** His Legendary deed is the story that took him over: a consequence pointing at its head (D45). */
function becomeLegendary(ctx: TickContext, head: Fact, id: CaptainId): void {
  const no = ctx.allocNo();
  ctx.patchCaptain(id, { legendaryFact: head.no });
  const line = say(ctx, ctx.state.content.banks.throne.legendary, head, id);
  ctx.facts.push({
    no,
    at: ctx.state.world.now,
    storyNo: head.no,
    line,
    tier: 'silent',
    cast: [id],
    ...ctx.link(no, { requires: [causeOf(head)] }),
    infamy: [],
    kind: 'legendary',
    captainId: id,
    deed: head.no,
  });
  appendLine(head, line);
}

/**
 * The Warlord falls (D43) if `id` is the Warlord: a `warlord_fell` consequence in `fact`'s story. The
 * throne is empty until the end of the tick, when `crownSuccessor` fills it. Returns whether he fell.
 */
export function warlordFalls(ctx: TickContext, fact: Fact, id: CaptainId, why: FallWhy): boolean {
  if (ctx.warlord() !== id) return false;
  const head = headOf(ctx, fact);
  const no = ctx.allocNo();
  // The fall requires what brought him down (the lost Clash, his death, the botched Dare).
  const links = ctx.link(no, { requires: [causeOf(fact)] });
  const line = say(ctx, ctx.state.content.banks.throne.fell[why], head, id);
  ctx.facts.push({
    no,
    at: ctx.state.world.now,
    storyNo: head.no,
    line,
    tier: 'silent',
    cast: [id],
    ...links,
    infamy: [],
    kind: 'warlord_fell',
    captainId: id,
    why,
  });
  appendLine(head, line);
  ctx.setWarlord(null);
  ctx.throneFall = { captainId: id, cause: { fact: no, blame: links.blame } };
  return true;
}

/**
 * Succession (D43, data-model decision 16): among living active Captains, the most Infamy in the last 7
 * days, then Power, then lifetime Infamy, then slug. The one who just fell sits this one out.
 */
export function successor(ctx: TickContext, exclude: CaptainId | null): CaptainId | null {
  const ranked = ctx
    .activeCaptains()
    .filter((id) => id !== exclude)
    .map((id) => ({ id, week: ctx.infamy7d(id), c: ctx.captain(id) }))
    .sort((a, b) => b.week - a.week || b.c.power - a.c.power || b.c.infamy - a.c.infamy || (a.id < b.id ? -1 : 1));
  return ranked[0]?.id ?? null;
}

/**
 * What won `id` the throne, as causes: his 7-day Infamy. Like a pair's affinity (decision 8b) it is an
 * aggregate, so its causes are the Facts behind his newest 3 gains in the window. The sim holds a gain's
 * Cause when the gain was made this tick, or when it is a Humiliation he still bears (gaining one gives
 * Infamy): that is how a Return carries its Blame on into a coup. Older gains take their slot but add no
 * Blame, like old-history Grudge tags.
 */
function standing(ctx: TickContext, id: CaptainId): Cause[] {
  const held = new Map<number, Cause>(ctx.facts.map((f) => [f.no, causeOf(f)]));
  for (const h of ctx.humiliations()) if (h.captainId === id) held.set(h.gained.fact, h.gained);
  return [...new Set(ctx.infamyGains(id).map((g) => g.fact))]
    .sort((a, b) => b - a)
    .slice(0, INFAMY.standingGains)
    .flatMap((no) => (held.has(no) ? [held.get(no)!] : []));
}

/**
 * Fills an empty throne, once the tick's other Facts are in (so their Infamy counts): the `crowned` story
 * head (it plays his Introduction), requiring the fall and his standing, and +20 Infamy for taking it.
 */
export function crownSuccessor(ctx: TickContext): void {
  if (ctx.warlord() !== null) return;
  const fall = ctx.throneFall;
  const id = successor(ctx, fall?.captainId ?? null);
  if (!id) return;
  const previous = fall?.captainId ?? null;
  const week = ctx.infamy7d(id);
  const no = ctx.allocNo();
  const t = ctx.state.content.templates.find((x) => x.id === ROSTER_TEMPLATES.crowned.id);
  const variant = ctx.rng.int(3) as 0 | 1 | 2;
  const names = new Map(ctx.state.content.cast.map((c) => [c.id, c.name]));
  const previousName = previous ? (names.get(previous) ?? previous) : ctx.state.content.banks.throne.emptyThrone;
  const head: Fact = {
    no,
    at: ctx.state.world.now,
    storyNo: no,
    ...(t
      ? { templateId: t.id, variant, line: renderLine(ctx, t.lines[variant], { warlord: id }, { previous: previousName }), tier: 'templated' as const }
      : { line: '', tier: 'silent' as const }),
    cast: previous ? [id, previous] : [id],
    ...ctx.link(no, { requires: [...(fall ? [fall.cause] : []), ...standing(ctx, id)] }),
    infamy: [],
    kind: 'crowned',
    intro: ctx.introduction(id),
    previous,
    infamy7d: week,
  };
  ctx.facts.push(head);
  ctx.setWarlord(id);
  gainInfamy(ctx, head, id, INFAMY.throne);
  followUp(ctx, head, 0);
  // Whatever that set off may have toppled him in turn: the throne is never left empty at the end of a tick.
  if (ctx.warlord() === null) crownSuccessor(ctx);
}

/** Power moves by `delta` (±1), kept within 1–10, with a silent `power` consequence in `fact`'s story. */
export function drift(ctx: TickContext, fact: Fact, id: CaptainId, delta: 1 | -1): void {
  const from = ctx.captain(id).power;
  const to = Math.max(POWER.min, Math.min(POWER.max, from + delta));
  if (to === from) return;
  ctx.patchCaptain(id, { power: to });
  const no = ctx.allocNo();
  ctx.facts.push({
    no,
    at: ctx.state.world.now,
    storyNo: fact.storyNo,
    line: '',
    tier: 'silent',
    cast: [id],
    ...ctx.link(no, { requires: [causeOf(fact)] }),
    infamy: [],
    kind: 'power',
    captainId: id,
    from,
    to,
  });
}

/** A throne-bank sentence about `captain`, picked by the story's line variant (no randomness spent). */
function say(ctx: TickContext, list: string[], head: Fact, captain: CaptainId): string {
  if (list.length === 0) return '';
  return renderLine(ctx, list[(head.variant ?? 0) % list.length]!, { captain });
}

function appendLine(head: Fact, sentence: string): void {
  if (!sentence) return;
  head.line = head.line ? `${head.line} ${sentence}` : sentence;
}

