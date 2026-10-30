// Rumours (#28, Meddle verbs #7): Intents become secret Meddles on a Fuse; a due Fuse lands the Rumour,
// which works, reaches the wrong orc or gets Garbled, and leaves a directed Grudge behind.
import { CLAIMS, RUMOUR_TEMPLATES, subjectText, type Claim } from '@orc/content';
import type { TickContext } from './context.ts';
import { consumeDare, fireDare } from './dares.ts';
import { gainInfamy, INFAMY } from './infamy.ts';
import { fireReactionFuse, followUp } from './reactions.ts';
import { maybeUnmask, UNMASK } from './roster.ts';
import { addMinutes, isoToMs } from './time.ts';
import type { BlameEntry, CaptainId, DareIntent, Fact, Fuse, Intent, Meddle, RumourIntent, Subject } from './types.ts';

export type RumourOutcome = 'works' | 'wrong_orc' | 'garbled';

/** Rumour rules. The numbers are the locked placeholders (#7, #15). */
export const RUMOUR = {
  /** Base odds per outcome (D-Meddle verbs: about 50/30/20). */
  odds: { works: 50, wrong_orc: 30, garbled: 20 } as Record<RumourOutcome, number>,
  /** A Compulsive Liar as the source garbles more (taken from `works`). */
  liarGarble: 35,
  /** Fuse lengths in whole minutes, inclusive. */
  fuse: { min: 10, max: 90 },
  firstFuse: { min: 2, max: 5 },
  /** How far a landed Claim drops the hearer's affinity toward the source. */
  sting: { insult: 20, fear: 25, theft: 30, mum: 30, coup: 40 } as Record<Claim, number>,
  /** Chance a Garble also swaps in an absurd subject (always, once the Claim tops the ladder). */
  absurdChance: 0.5,
  /** Wrong orc: weight of a Captain who shares the subject, against 1 for anyone else. */
  sharerWeight: 3,
} as const;

const MAX_FREE_TEXT = 200;
const isClaim = (c: unknown): c is Claim => (CLAIMS as readonly unknown[]).includes(c);

/**
 * Consumes Players' Intents (already debited by `submit_intent`). A valid Rumour becomes a pending
 * Meddle and a Fuse; anything invalid is rejected and its Meddle refunded.
 */
export function consumeIntents(ctx: TickContext, intents: Intent[]): void {
  for (const intent of intents) {
    if (intent.kind === 'back' || intent.kind === 'withdraw') continue; // backing.ts consumes these (#36)
    if (intent.kind === 'dare') {
      consumeDare(ctx, intent); // dares.ts (#35)
      continue;
    }
    if (!ctx.state.players[intent.playerId]) {
      // A Player who has left: nothing to refund.
      ctx.diff.intents.push({ id: intent.id, status: 'rejected', reason: 'unknown_player' });
      continue;
    }
    const reason = intent.kind === 'rumour' ? invalidRumour(ctx, intent) : 'unsupported_kind';
    if (reason) {
      ctx.diff.intents.push({ id: intent.id, status: 'rejected', reason });
      if (intent.kind === 'rumour') ctx.addMeddles(intent.playerId, 1);
      continue;
    }
    plantRumour(ctx, intent as Intent & RumourIntent);
  }
}

function invalidRumour(ctx: TickContext, r: Intent & RumourIntent): string | null {
  const { captains, trophies } = ctx.state;
  const source = captains[r.source];
  const target = captains[r.target];
  if (!source || !target) return 'unknown_captain';
  if (r.source === r.target) return 'same_captain';
  if (ctx.rosterOf(r.source) === 'reserve' || ctx.rosterOf(r.target) === 'reserve') return 'benched_captain';
  if (!isClaim(r.claim)) return 'bad_claim';
  const s = r.subject as Subject | undefined;
  const ok =
    (s?.from === 'trait' && target.traits.includes(s.key)) ||
    (s?.from === 'fear' && target.fears.some((f) => f.fear === s.key)) ||
    (s?.from === 'trophy' && trophies.some((t) => t.holder === r.target && t.key === s.key));
  if (!ok) return 'bad_subject';
  if (r.freeText !== undefined && (typeof r.freeText !== 'string' || r.freeText.length > MAX_FREE_TEXT)) {
    return 'bad_free_text';
  }
  return null;
}

function plantRumour(ctx: TickContext, intent: Intent & RumourIntent): void {
  // The guided first Rumour lands within minutes, but only a Player's genuine first Meddle gets it.
  const first = intent.firstMeddle && !ctx.firstMeddleDone(intent.playerId);
  const { min, max } = first ? RUMOUR.firstFuse : RUMOUR.fuse;
  const minutes = min + ctx.rng.int(max - min + 1);
  ctx.markFirstMeddle(intent.playerId);

  // The stored Meddle keeps only what landing needs; `firstMeddle` has done its job once fused.
  const meddle: Meddle = {
    id: intent.id,
    playerId: intent.playerId,
    intent: {
      kind: 'rumour',
      source: intent.source,
      target: intent.target,
      claim: intent.claim,
      subject: { from: intent.subject.from, key: intent.subject.key },
      ...(intent.freeText ? { freeText: intent.freeText } : {}),
      firstMeddle: false,
    },
    status: 'pending',
    heldOn: null,
  };
  ctx.diff.newMeddles.push(meddle);
  ctx.diff.fuses.add.push({ no: ctx.allocNo(), dueAt: addMinutes(ctx.state.world.now, minutes), meddleId: intent.id });
  ctx.diff.intents.push({ id: intent.id, status: 'consumed' });
}

/**
 * Fires every Fuse due by now, in (dueAt, no) order. After an outage they all fire on the one tick
 * (data-model decision 15).
 */
export function fireDueFuses(ctx: TickContext): void {
  const now = isoToMs(ctx.state.world.now);
  const due = ctx.state.fuses
    .filter((f) => isoToMs(f.dueAt) <= now)
    .sort((a, b) => isoToMs(a.dueAt) - isoToMs(b.dueAt) || a.no - b.no);
  for (const fuse of due) fire(ctx, fuse);
}

function fire(ctx: TickContext, fuse: Fuse): void {
  ctx.diff.fuses.remove.push(fuse.no);
  if (fuse.reaction) return fireReactionFuse(ctx, { ...fuse, reaction: fuse.reaction });
  const meddle = fuse.meddleId ? ctx.state.meddles[fuse.meddleId] : undefined;
  if (meddle?.intent.kind === 'dare') return fireDare(ctx, meddle as Meddle & { intent: DareIntent });
  if (!meddle || meddle.intent.kind !== 'rumour') return;
  const r = meddle.intent;
  if (ctx.rosterOf(r.target) === 'dead') {
    // Held until he Returns (and re-fused then). A diff only, never a Fact: it's still secret. A dead
    // source doesn't hold it (data-model decision 16).
    ctx.diff.meddles.push({ id: meddle.id, status: 'held', heldOn: r.target });
    return;
  }
  landRumour(ctx, meddle, r);
}

function landRumour(ctx: TickContext, meddle: Meddle, r: RumourIntent): void {
  const { state, rng } = ctx;
  const odds = Object.entries(outcomeOdds(ctx, r)).filter(([, w]) => w > 0);
  const outcome = rng.weighted(odds, ([, w]) => w)[0] as RumourOutcome;

  let reached = r.target;
  let claim: Claim = r.claim;
  let subject: Subject | { from: 'absurd'; key: string } = r.subject;
  if (outcome === 'wrong_orc') {
    reached = wrongOrc(ctx, r) ?? r.target;
  } else if (outcome === 'garbled') {
    const ladder = state.content.banks.garbleLadder;
    const step = Math.max(0, ladder.indexOf(claim));
    const top = step === ladder.length - 1;
    claim = ladder[Math.min(step + 1, ladder.length - 1)]!;
    if (top || rng.chance(RUMOUR.absurdChance)) {
      subject = { from: 'absurd', key: rng.pick(Object.keys(state.content.banks.absurdSubjects).sort()) };
    }
  }

  const template = state.content.templates.find((t) => t.id === RUMOUR_TEMPLATES[outcome]);
  const variant = rng.int(3) as 0 | 1 | 2;
  const said = state.content.banks.claims[claim].phrasings[variant].replace('{subject}', subjectText(state.content, subject));
  const no = ctx.allocNo();
  const own: BlameEntry[] = [
    { meddleId: meddle.id, playerId: meddle.playerId, verb: 'rumour', landedFact: no, landedAt: state.world.now, hops: 0 },
  ];
  // A landing requires nothing in the world: its only Blame is its own Meddle.
  const { causes, blame } = ctx.link(no, { own });
  const cast = [...new Set([r.source, r.target, reached])];
  const head: Fact = {
    no,
    at: state.world.now,
    storyNo: no,
    ...(template ? { templateId: template.id, variant } : {}),
    line: template ? renderLine(ctx, template.lines[variant], { source: r.source, target: r.target, reached }, { claim: said }) : '',
    tier: template ? 'templated' : 'silent',
    cast,
    causes,
    blame,
    infamy: [],
    kind: 'rumour',
    meddleId: meddle.id,
    source: r.source,
    intended: r.target,
    reached,
    outcome,
    claim: r.claim,
    ...(outcome === 'garbled' ? { garbledTo: claim } : {}),
    subject,
  };
  ctx.facts.push(head);
  ctx.diff.meddles.push({ id: meddle.id, status: 'landed', landedFact: no });
  // It backfires on its supposed source: the fortress now believes he said it (D42, notable).
  gainInfamy(ctx, head, r.source, INFAMY.rumourSource);

  // Whoever heard it now holds a Grudge against the supposed source: affinity down, a permanent tag.
  const before = ctx.getAffinity(reached, r.source);
  const after = ctx.setAffinity(reached, r.source, before - RUMOUR.sting[claim]);
  const tag = said;
  const grudgeNo = ctx.allocNo();
  const landing = { fact: no, blame };
  ctx.facts.push({
    no: grudgeNo,
    at: state.world.now,
    storyNo: no,
    line: '',
    tier: 'silent',
    cast: [reached, r.source],
    // The Grudge follows from the landing; the same Meddle keeps it at hop 0.
    ...ctx.link(grudgeNo, { requires: [landing], own }),
    infamy: [],
    kind: 'grudge',
    holder: reached,
    toward: r.source,
    tag,
    delta: after - before,
  });
  ctx.diff.grudgeTags.push({
    no: ctx.allocNo(),
    holder: reached,
    toward: r.source,
    tag,
    at: state.world.now,
    cause: landing,
  });
  // A Rumour about a disguised Captain may blow his cover.
  maybeUnmask(ctx, head, r.target, 'rumour', UNMASK.rumour);
  // Now the hearer reacts (a Hothead goes straight for the source, #7).
  followUp(ctx, head, 0);
}

/** 50/30/20, shifted by Traits: a Gullible target swallows it whole, a Compulsive Liar source garbles. */
function outcomeOdds(ctx: TickContext, r: RumourIntent): Record<RumourOutcome, number> {
  const odds = { ...RUMOUR.odds };
  if (ctx.state.captains[r.source]?.traits.includes('Compulsive Liar')) {
    odds.works -= RUMOUR.liarGarble - odds.garbled;
    odds.garbled = RUMOUR.liarGarble;
  }
  if (ctx.state.captains[r.target]?.traits.includes('Gullible')) {
    odds.works += odds.garbled;
    odds.garbled = 0;
  }
  return odds;
}

/** Another active Captain, biased towards one who shares the subject (the bucket finds the bucket-wearer). */
function wrongOrc(ctx: TickContext, r: RumourIntent): CaptainId | null {
  const candidates = ctx.activeCaptains().filter((id) => id !== r.source && id !== r.target);
  if (candidates.length === 0) return null;
  const shares = (id: CaptainId) => {
    const c = ctx.state.captains[id]!;
    const { from, key } = r.subject;
    if (from === 'trait') return c.traits.includes(key);
    if (from === 'fear') return c.fears.some((f) => f.fear === key);
    return ctx.state.trophies.some((t) => t.holder === id && t.key === key);
  };
  return ctx.rng.weighted(candidates, (id) => (shares(id) ? RUMOUR.sharerWeight : 1));
}

/** Fills `{role}` with Captain names and `{slot}` with text. */
export function renderLine(
  ctx: TickContext,
  line: string,
  cast: Record<string, CaptainId>,
  slots: Record<string, string> = {},
): string {
  const names = new Map(ctx.state.content.cast.map((c) => [c.id, c.name]));
  return line.replace(/\{([^}]+)\}/g, (_, key: string) =>
    key in slots ? slots[key]! : (names.get(cast[key] ?? '') ?? key),
  );
}
