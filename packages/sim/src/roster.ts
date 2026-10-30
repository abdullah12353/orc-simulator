// Death, Return and the roster (#32; Failing Upward #9: D40, D41, D44). Any disaster can kill, but only 3
// a London day, and never inside a Captain's hour of grace: then he is Humiliated instead. Every Captain
// Returns 2–12 h later with exactly one Humiliation that fits how he died. The active roster stays at 12:
// a reserve Captain steps in on a death, and a Returner benches the least infamous active Captain.
//
// The seams: anything that can kill calls `disaster(ctx, head, victim, causeTag)` once its story head is
// written; anything that can expose a disguise calls `maybeUnmask`. `processReturns` runs once a tick,
// straight after the day roll.
import { compareCodeUnits, KRUG, ROSTER_TEMPLATES, type CauseTag, type HumiliationDef } from '@orc/content';
import { causeOf } from './blame.ts';
import type { TickContext } from './context.ts';
import { drift, gainInfamy, INFAMY, warlordFalls } from './infamy.ts';
import { followUp } from './reactions.ts';
import { renderLine } from './rumours.ts';
import { addMinutes, isoToMs } from './time.ts';
import type { CaptainId, Cause, Fact, FactNo, Humiliation, Introduction } from './types.ts';

export const ROSTER = {
  /** The active roster (D44). */
  activeSize: 12,
  /** Deaths per London day; past it a death becomes a Humiliation (D47). */
  deathCap: 3,
  /** A dead Captain Returns this many minutes later (2–12 h, inclusive). */
  returnMinutes: { min: 120, max: 720 },
  /** After a Return he can't die for an hour (D40). */
  graceMinutes: 60,
  /** Bandages heal after about 2 days. */
  bandageHours: 48,
  /** A Meddle held on a dead target is re-fused this many minutes after his Return (inclusive). */
  refuseMinutes: { min: 10, max: 90 },
  /** At most this many Fears: a new one replaces his oldest added Fear, never the starting one. */
  maxFears: 3,
} as const;

/** Chance a disguised Captain is Unmasked: by losing a Clash and surviving it, or by a Rumour about him. */
export const UNMASK = { clash: 0.5, rumour: 0.3 } as const;

/**
 * A disaster in the story headed by `head` would kill `victim` (if he's still active). At the day's death
 * cap, or inside his grace, it becomes `death_averted` plus one Humiliation fitting `tag`. Otherwise he
 * dies: he Returns 2–12 h later, his disguise falls off, and a reserve Captain steps in. `depth` is the
 * reaction depth of `head`: the stepping in reacts on from there.
 */
export function disaster(ctx: TickContext, head: Fact, victim: CaptainId, tag: CauseTag, depth = 0): void {
  if (ctx.rosterOf(victim) !== 'active') return;
  const { state, rng } = ctx;
  const now = state.world.now;
  const c = ctx.captain(victim);
  const bank = state.content.banks.death;
  const headCause: Cause = causeOf(head);

  const why =
    c.graceUntil !== null && isoToMs(c.graceUntil) > isoToMs(now)
      ? ('grace' as const)
      : ctx.deathsToday() >= ROSTER.deathCap
        ? ('daily_cap' as const)
        : null;
  if (why) {
    const no = ctx.allocNo();
    const { causes, blame } = ctx.link(no, { requires: [headCause] });
    const line = say(ctx, bank.averted[why], head, victim);
    ctx.facts.push({ no, at: now, storyNo: head.no, line, tier: 'silent', cast: [victim], causes, blame, infamy: [], kind: 'death_averted', captainId: victim, why });
    appendLine(head, line);
    const choice = chooseHumiliation(ctx, victim, tag);
    if (choice) applyHumiliation(ctx, victim, choice, head.no, [{ fact: no, blame }]);
    return;
  }

  const { min, max } = ROSTER.returnMinutes;
  const returnsAt = addMinutes(now, min + rng.int(max - min + 1));
  const no = ctx.allocNo();
  const { causes, blame } = ctx.link(no, { requires: [headCause] });
  const line = say(ctx, bank.died, head, victim);
  const deathFact: Fact = { no, at: now, storyNo: head.no, line, tier: 'silent', cast: [victim], causes, blame, infamy: [], kind: 'death', captainId: victim, causeTag: tag, returnsAt };
  ctx.facts.push(deathFact);
  ctx.misfortune(victim, deathFact);
  appendLine(head, line);
  // Dying makes him weaker and more famous at once (D42), and a dead Warlord rules nothing (D43).
  gainInfamy(ctx, deathFact, victim, INFAMY.death);
  drift(ctx, deathFact, victim, -1);
  warlordFalls(ctx, deathFact, victim, 'death');
  const death = causeOf(deathFact);
  ctx.patchCaptain(victim, { roster: 'dead', returnsAt, death: { cause: death, causeTag: tag } });
  ctx.diff.world.deathsToday = ctx.deathsToday() + 1;

  // A disguise lasts until he's Unmasked or dies again.
  for (const h of ctx.humiliations().filter((x) => x.captainId === victim && x.cat === 'disguise')) {
    endHumiliation(ctx, h, 'died', head.no, [death]);
  }
  stepIn(ctx, victim, death, depth);
}

/**
 * A disaster in the story headed by `head` leaves `victim` alive but marked: one Humiliation fitting `tag`
 * (a botched Dare that didn't kill him, #35). Nothing if he isn't active or has every fitting one already.
 */
export function humiliate(ctx: TickContext, head: Fact, victim: CaptainId, tag: CauseTag): void {
  if (ctx.rosterOf(victim) !== 'active') return;
  const choice = chooseHumiliation(ctx, victim, tag);
  if (choice) applyHumiliation(ctx, victim, choice, head.no, [causeOf(head)]);
}

/** Bandages that are due heal, then every Captain whose Return is due comes back, in (returnsAt, slug) order. */
export function processReturns(ctx: TickContext): void {
  const now = isoToMs(ctx.state.world.now);
  for (const h of ctx.humiliations()) {
    if (h.cat === 'bandage' && h.expiresAt !== null && isoToMs(h.expiresAt) <= now) endHumiliation(ctx, h, 'healed', null, []);
  }
  const due = Object.keys(ctx.state.captains)
    .map((id) => ctx.captain(id))
    .filter((c) => c.roster === 'dead' && c.returnsAt !== null && isoToMs(c.returnsAt) <= now)
    .sort((a, b) => isoToMs(a.returnsAt!) - isoToMs(b.returnsAt!) || compareCodeUnits(a.id, b.id));
  for (const c of due) returnCaptain(ctx, c.id);
}

/**
 * A disguised, living Captain is exposed with `chance`, as a story of its own that requires `head` (the
 * Clash he lost, or the Rumour about him). His disguise ends and he goes by his own name again. `depth` is
 * the reaction depth of `head`.
 */
export function maybeUnmask(ctx: TickContext, head: Fact, id: CaptainId, by: 'clash' | 'rumour', chance: number, depth = 0): void {
  if (ctx.rosterOf(id) !== 'active') return;
  const disguise = ctx.humiliations().find((h) => h.captainId === id && h.cat === 'disguise');
  if (!disguise || !ctx.rng.chance(chance)) return;
  const alias = aliasOf(ctx, id, ctx.captain(id).aliasIdx ?? 0);
  const no = ctx.allocNo();
  const { causes, blame } = ctx.link(no, { requires: [causeOf(head)] });
  const fact: Fact = {
    no,
    at: ctx.state.world.now,
    storyNo: no,
    ...voice(ctx, ROSTER_TEMPLATES.unmasked.id, { captain: id }, { alias }),
    cast: [id],
    causes,
    blame,
    infamy: [],
    kind: 'unmasked',
    captainId: id,
    by,
  };
  ctx.facts.push(fact);
  gainInfamy(ctx, fact, id, INFAMY.unmasked);
  endHumiliation(ctx, disguise, 'unmasked', no, [causeOf(fact)]);
  followUp(ctx, fact, depth);
}

/** The Return head, then its Humiliation, then whoever it benches; his held Meddles go back on a Fuse. */
function returnCaptain(ctx: TickContext, id: CaptainId): void {
  const { state, rng } = ctx;
  const now = state.world.now;
  const before = ctx.captain(id);
  const death = before.death ?? { cause: null, causeTag: 'beaten' as CauseTag };
  const choice = chooseHumiliation(ctx, id, death.causeTag as CauseTag);
  const graceUntil = addMinutes(now, ROSTER.graceMinutes);
  ctx.patchCaptain(id, { roster: 'active', returnsAt: null, death: null, graceUntil });

  const no = ctx.allocNo();
  const { causes, blame } = ctx.link(no, { requires: death.cause ? [death.cause] : [] });
  const intro: Introduction = {
    ...ctx.introduction(id),
    ...(choice?.def.cat === 'disguise' ? { aliasIdx: choice.aliasIdx } : {}),
    ...(choice?.def.cat === 'epithet' ? { epithet: choice.def.epithet! } : {}),
  };
  const head: Fact = {
    no,
    at: now,
    storyNo: no,
    ...voice(ctx, ROSTER_TEMPLATES.return.id, { returner: id }, { how: choice ? howText(ctx, id, choice) : '' }),
    cast: [id],
    causes,
    blame,
    infamy: [],
    kind: 'return',
    intro,
    graceUntil,
  };
  ctx.facts.push(head);
  const headCause = causeOf(head);
  if (choice) applyHumiliation(ctx, id, choice, no, [headCause]);
  bench(ctx, id, head);

  // Held Meddles fire again, each on a fresh Fuse (D40).
  const { min, max } = ROSTER.refuseMinutes;
  const held = Object.values(state.meddles)
    .filter((m) => m.status === 'held' && m.heldOn === id)
    .sort((a, b) => compareCodeUnits(a.id, b.id));
  for (const m of held) {
    ctx.diff.meddles.push({ id: m.id, status: 'pending', heldOn: null });
    ctx.diff.fuses.add.push({ no: ctx.allocNo(), dueAt: addMinutes(now, min + rng.int(max - min + 1)), meddleId: m.id });
  }
  followUp(ctx, head, 0);
}

/**
 * A Returner makes 13: the active Captain with the least Infamy in the last 7 days goes to the reserve (slug
 * breaks a tie), never Krúg, the Warlord or a Legendary Captain (D45: permanent, he keeps playing).
 */
function bench(ctx: TickContext, returner: CaptainId, head: Fact): void {
  const active = ctx.activeCaptains();
  if (active.length <= ROSTER.activeSize) return;
  const warlord = ctx.warlord();
  const [id] = active
    .filter((x) => x !== returner && x !== KRUG && x !== warlord && ctx.captain(x).legendaryFact === null)
    .sort((a, b) => benchScore(ctx, a) - benchScore(ctx, b) || compareCodeUnits(a, b));
  if (!id) return;
  ctx.patchCaptain(id, { roster: 'reserve' });
  const no = ctx.allocNo();
  const line = say(ctx, ctx.state.content.banks.death.benched, head, id);
  ctx.facts.push({
    no,
    at: ctx.state.world.now,
    storyNo: head.no,
    line,
    tier: 'silent',
    cast: [id],
    ...ctx.link(no, { requires: [causeOf(head)] }),
    infamy: [],
    kind: 'benched',
    captainId: id,
  });
  appendLine(head, line);
}

/** Who gets benched first: the least Infamy in the last 7 days (data-model §4.4). */
function benchScore(ctx: TickContext, id: CaptainId): number {
  return ctx.infamy7d(id);
}

/** A reserve Captain, drawn at random, steps into the active roster with his Introduction (a story head). */
function stepIn(ctx: TickContext, dead: CaptainId, death: Cause, depth: number): void {
  if (ctx.activeCaptains().length >= ROSTER.activeSize) return;
  const reserve = Object.keys(ctx.state.captains)
    .filter((id) => ctx.rosterOf(id) === 'reserve')
    .sort();
  if (reserve.length === 0) return;
  const id = ctx.rng.pick(reserve);
  ctx.patchCaptain(id, { roster: 'active' });
  const no = ctx.allocNo();
  const head: Fact = {
    no,
    at: ctx.state.world.now,
    storyNo: no,
    ...voice(ctx, ROSTER_TEMPLATES.stepped_in.id, { newcomer: id, dead }),
    cast: [id, dead],
    // He's only here because the other one died.
    ...ctx.link(no, { requires: [death] }),
    infamy: [],
    kind: 'stepped_in',
    intro: ctx.introduction(id),
    replacing: dead,
  };
  ctx.facts.push(head);
  followUp(ctx, head, depth);
}

interface Choice {
  key: string;
  def: HumiliationDef;
  /** A disguise's alias. */
  aliasIdx: 0 | 1 | null;
}

/**
 * Picks one Humiliation that fits the cause tag and that he can take (not a bandage or lost bit he already
 * has, a second disguise, the Epithet he already has, or a Fear he already has): a category first, so every
 * category that fits is equally likely, then an entry in it. Spends randomness only once there's a pick.
 */
function chooseHumiliation(ctx: TickContext, id: CaptainId, tag: CauseTag): Choice | null {
  const bank = ctx.state.content.banks.humiliations;
  const c = ctx.captain(id);
  const current = ctx.humiliations().filter((h) => h.captainId === id);
  const takes = (key: string): boolean => {
    const h = bank[key]!;
    switch (h.cat) {
      case 'bandage':
      case 'lost_bit':
        return !current.some((x) => x.key === key);
      case 'disguise':
        return c.aliasIdx === null && !current.some((x) => x.cat === 'disguise');
      case 'epithet':
        return h.epithet !== c.epithet;
      case 'fear':
        return !c.fears.some((f) => f.fear === h.fear);
    }
  };
  const keys = Object.keys(bank).sort().filter(takes);
  const fitting = keys.filter((k) => bank[k]!.causes.includes(tag));
  // Only when nothing that fits is left (he has it all already) does any Humiliation do.
  const pool = fitting.length > 0 ? fitting : keys;
  if (pool.length === 0) return null;
  const cats = [...new Set(pool.map((k) => bank[k]!.cat))].sort();
  const cat = ctx.rng.pick(cats);
  const key = ctx.rng.pick(pool.filter((k) => bank[k]!.cat === cat));
  const def = bank[key]!;
  return { key, def, aliasIdx: def.cat === 'disguise' ? (ctx.rng.int(2) as 0 | 1) : null };
}

/**
 * Puts the Humiliation on him, as a consequence in story `storyNo` requiring `requires`. Lifetimes (D41): a
 * bandage heals in about 2 days; a disguise lasts until Unmasked or he dies; a new Epithet replaces the old
 * one; a 4th Fear replaces his oldest added Fear. None of them touch Power or the odds.
 */
function applyHumiliation(ctx: TickContext, id: CaptainId, choice: Choice, storyNo: FactNo, requires: Cause[]): void {
  const { state } = ctx;
  const now = state.world.now;
  const { key, def } = choice;
  const no = ctx.allocNo();
  const { causes, blame } = ctx.link(no, { requires });
  const gained: Cause = { fact: no, blame };
  const current = ctx.humiliations().filter((h) => h.captainId === id);
  const replaced: Humiliation[] = [];

  if (def.cat === 'epithet') {
    replaced.push(...current.filter((h) => h.cat === 'epithet'));
    ctx.patchCaptain(id, { epithet: def.epithet! });
  } else if (def.cat === 'disguise') {
    ctx.patchCaptain(id, { aliasIdx: choice.aliasIdx });
  } else if (def.cat === 'fear') {
    const fears = ctx.fears(id);
    const oldest = fears
      .filter((f) => f.added)
      .sort((a, b) => isoToMs(a.since) - isoToMs(b.since) || compareCodeUnits(a.fear, b.fear))[0];
    const remove = fears.length >= ROSTER.maxFears ? oldest?.fear : undefined;
    if (remove !== undefined) {
      replaced.push(...current.filter((h) => h.cat === 'fear' && state.content.banks.humiliations[h.key]?.fear === remove));
    }
    ctx.diff.fears.push({ captainId: id, add: def.fear!, ...(remove !== undefined ? { remove } : {}) });
  }

  const expiresAt = def.cat === 'bandage' ? addMinutes(now, ROSTER.bandageHours * 60) : null;
  const fact: Fact = {
    no,
    at: now,
    storyNo,
    line: '',
    tier: 'silent',
    cast: [id],
    causes,
    blame,
    infamy: [],
    kind: 'humiliation',
    captainId: id,
    cat: def.cat,
    key,
    ...(replaced[0] ? { replaces: replaced[0].no } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  };
  ctx.facts.push(fact);
  ctx.misfortune(id, fact);
  gainInfamy(ctx, fact, id, INFAMY.humiliation);
  ctx.upsertHumiliation({ no: ctx.allocNo(), captainId: id, cat: def.cat, key, gained, expiresAt, ended: false });
  for (const old of replaced) endHumiliation(ctx, old, 'replaced', storyNo, [gained]);
}

/** Ends a Humiliation (kept in the DB as history). A healed bandage is a silent story of its own. */
function endHumiliation(
  ctx: TickContext,
  h: Humiliation,
  why: 'healed' | 'unmasked' | 'replaced' | 'died',
  storyNo: FactNo | null,
  requires: Cause[],
): void {
  const no = ctx.allocNo();
  ctx.facts.push({
    no,
    at: ctx.state.world.now,
    storyNo: storyNo ?? no,
    line: '',
    tier: 'silent',
    cast: [h.captainId],
    ...ctx.link(no, { requires }),
    infamy: [],
    kind: 'humiliation_ended',
    captainId: h.captainId,
    humiliation: h.no,
    why,
  });
  ctx.upsertHumiliation({ ...h, ended: true });
  if (h.cat === 'disguise') ctx.patchCaptain(h.captainId, { aliasIdx: null });
}

/** A roster Template's line (variant drawn), or a silent Fact if the bundle lacks the Template. */
function voice(
  ctx: TickContext,
  templateId: string,
  cast: Record<string, CaptainId>,
  slots: Record<string, string> = {},
): Pick<Fact, 'templateId' | 'variant' | 'line' | 'tier'> {
  const t = ctx.state.content.templates.find((x) => x.id === templateId);
  if (!t) return { line: '', tier: 'silent' };
  const variant = ctx.rng.int(3) as 0 | 1 | 2;
  return { templateId: t.id, variant, line: renderLine(ctx, t.lines[variant], cast, slots), tier: 'templated' };
}

/** How he comes back: the Humiliation's text with his name, alias and new Epithet filled in. */
function howText(ctx: TickContext, id: CaptainId, choice: Choice): string {
  const { content } = ctx.state;
  const name = content.cast.find((c) => c.id === id)?.name ?? id;
  const slots: Record<string, string> = {
    name,
    alias: choice.aliasIdx !== null ? aliasOf(ctx, id, choice.aliasIdx) : name,
    epithet: choice.def.epithet ? (content.banks.epithets[choice.def.epithet]?.text ?? '') : '',
  };
  return choice.def.text.replace(/\{([^}]+)\}/g, (_, k: string) => slots[k] ?? k);
}

function aliasOf(ctx: TickContext, id: CaptainId, idx: 0 | 1): string {
  const card = ctx.state.content.cast.find((c) => c.id === id);
  return card?.aliases[idx] ?? id;
}

/** A death-bank sentence about `captain`, picked by the story's line variant (no randomness spent). */
function say(ctx: TickContext, list: string[], head: Fact, captain: CaptainId): string {
  if (list.length === 0) return '';
  return renderLine(ctx, list[(head.variant ?? 0) % list.length]!, { captain });
}

/** Adds a sentence to a story head's line, so the Herald tells the whole story. */
function appendLine(head: Fact, sentence: string): void {
  if (!sentence) return;
  head.line = head.line ? `${head.line} ${sentence}` : sentence;
}
