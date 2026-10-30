// Dares (#35, Meddle verbs #7; user stories 42–46). A Player Dares a Captain into a Stunt, or into a Prank on
// another Captain (the victim). Like a Rumour it is a secret Meddle on a 10–90 min Fuse. When it lands he
// botches it (about 60%), pulls it off or refuses. A botched Dare can kill him (death cap and grace apply),
// humiliate him, and topple him if he is the Warlord; a Prank that comes off, or goes wrong, leaves the
// victim a Grudge against him.
import { compareCodeUnits, dareFits, DARE_TEMPLATES, daresFor, playsOnFear, SURPRISE, subjectText, type DareDef } from '@orc/content';
import type { TickContext } from './context.ts';
import { holdGrudge } from './grudge.ts';
import { gainInfamy, INFAMY, warlordFalls } from './infamy.ts';
import { followUp } from './reactions.ts';
import { disaster, humiliate } from './roster.ts';
import { renderLine } from './rumours.ts';
import { addMinutes } from './time.ts';
import type { BlameEntry, CaptainId, DareIntent, Fact, Intent, Meddle } from './types.ts';

export type DareOutcome = 'botched' | 'pulled_off' | 'refused';

/** Dare rules. The odds are the locked placeholders (D-Meddle verbs: about 60/20/20). */
export const DARE = {
  odds: { botched: 60, pulled_off: 20, refused: 20 } as Record<DareOutcome, number>,
  /** A Dare that plays on his Fear goes wrong more often (taken from `pulled_off`). */
  fearOdds: { botched: 75, pulled_off: 5, refused: 20 } as Record<DareOutcome, number>,
  /** Fuse lengths in whole minutes, inclusive (the guided first Meddle gets the short one). */
  fuse: { min: 10, max: 90 },
  firstFuse: { min: 2, max: 5 },
  /** A botched Dare kills with this chance; otherwise it Humiliates him with `humiliation`. */
  botched: { death: 0.3, humiliation: 0.5 },
  /** How far a Prank drops the victim's affinity toward the target: it came off, or went wrong on him. */
  sting: { pulled_off: 30, botched: 15 } as Partial<Record<DareOutcome, number>>,
} as const;

/** Consumes one Dare Intent (already debited): a pending Meddle on a Fuse, or a rejection and a refund. */
export function consumeDare(ctx: TickContext, intent: Intent & DareIntent): void {
  if (!ctx.state.players[intent.playerId]) {
    ctx.diff.intents.push({ id: intent.id, status: 'rejected', reason: 'unknown_player' });
    return;
  }
  const reason = invalidDare(ctx, intent);
  if (reason) {
    ctx.diff.intents.push({ id: intent.id, status: 'rejected', reason });
    ctx.addMeddles(intent.playerId, 1);
    return;
  }
  const first = intent.firstMeddle && !ctx.firstMeddleDone(intent.playerId);
  const { min, max } = first ? DARE.firstFuse : DARE.fuse;
  const minutes = min + ctx.rng.int(max - min + 1);
  ctx.markFirstMeddle(intent.playerId);
  // The stored Meddle keeps only what landing needs (and hashes like the row the tick loads back).
  const meddle: Meddle = {
    id: intent.id,
    playerId: intent.playerId,
    intent: {
      kind: 'dare',
      target: intent.target,
      dareKey: intent.dareKey,
      ...(intent.victim !== undefined ? { victim: intent.victim } : {}),
      firstMeddle: false,
    },
    status: 'pending',
    heldOn: null,
  };
  ctx.diff.newMeddles.push(meddle);
  ctx.diff.fuses.add.push({ no: ctx.allocNo(), dueAt: addMinutes(ctx.state.world.now, minutes), meddleId: intent.id });
  ctx.diff.intents.push({ id: intent.id, status: 'consumed' });
}

function invalidDare(ctx: TickContext, d: Intent & DareIntent): string | null {
  const target = ctx.state.captains[d.target];
  if (!target) return 'unknown_captain';
  if (ctx.rosterOf(d.target) === 'reserve') return 'benched_captain';
  if (d.dareKey === SURPRISE) return d.victim === undefined ? null : 'bad_victim';
  const def = ctx.state.content.banks.dares[d.dareKey];
  if (!def || !dareFits(def, target)) return 'bad_dare';
  if (def.kind === 'stunt') return d.victim === undefined ? null : 'bad_victim';
  const victim = d.victim === undefined ? undefined : ctx.state.captains[d.victim];
  if (!victim || d.victim === d.target || ctx.rosterOf(d.victim!) === 'reserve') return 'bad_victim';
  return null;
}

/**
 * A Dare's Fuse came due. Held (no Fact: still secret) while the target is dead. A dead Prank victim
 * holds nothing, like a Rumour's dead source: only a dead target holds a Meddle (data-model decision 16).
 */
export function fireDare(ctx: TickContext, meddle: Meddle & { intent: DareIntent }): void {
  const d = meddle.intent;
  if (ctx.rosterOf(d.target) === 'dead') {
    ctx.diff.meddles.push({ id: meddle.id, status: 'held', heldOn: d.target });
    return;
  }
  const pick = pickDare(ctx, d);
  if (!pick) return; // a surprise with nothing that fits him: the bundle changed under it
  landDare(ctx, meddle, pick.key, pick.victim);
}

/** The Dare it names, or for a surprise one that fits him now (and, for a Prank, a victim). */
function pickDare(ctx: TickContext, d: DareIntent): { key: string; victim?: CaptainId } | null {
  if (d.dareKey !== SURPRISE) return { key: d.dareKey, ...(d.victim !== undefined ? { victim: d.victim } : {}) };
  const victims = ctx.activeCaptains().filter((id) => id !== d.target);
  const keys = daresFor(ctx.state.content, ctx.captain(d.target)).filter(
    (k) => victims.length > 0 || ctx.state.content.banks.dares[k]!.kind === 'stunt',
  );
  if (keys.length === 0) return null;
  const key = ctx.rng.pick(keys);
  return ctx.state.content.banks.dares[key]!.kind === 'prank' ? { key, victim: ctx.rng.pick(victims) } : { key };
}

function landDare(ctx: TickContext, meddle: Meddle, key: string, victim: CaptainId | undefined): void {
  const { state, rng } = ctx;
  const now = state.world.now;
  const def: DareDef = state.content.banks.dares[key]!;
  const target = (meddle.intent as DareIntent).target;
  const fears = ctx.fears(target).map((f) => f.fear);
  const onFear = playsOnFear(def, fears);
  const fear = onFear ? fears.find((f) => def.tags.includes(f))! : null;
  // In key order, so the draw never depends on how the odds object happens to be written.
  const odds = Object.entries(onFear ? DARE.fearOdds : DARE.odds)
    .filter(([, w]) => w > 0)
    .sort(([a], [b]) => compareCodeUnits(a, b));
  const outcome = rng.weighted(odds, ([, w]) => w)[0] as DareOutcome;

  const template = state.content.templates.find((t) => t.id === DARE_TEMPLATES[def.kind][outcome]);
  const variant = rng.int(3) as 0 | 1 | 2;
  const roles: Record<string, CaptainId> = { target, ...(victim !== undefined ? { victim } : {}) };
  const text = renderLine(ctx, def.text, roles);
  let line = template ? renderLine(ctx, template.lines[variant], roles, { dare: text }) : '';
  if (fear && line) {
    const bank = state.content.banks.dareFear;
    line += ` ${bank[variant % bank.length]!.replace('{fear}', subjectText(state.content, { from: 'fear', key: fear }))}`;
  }

  const no = ctx.allocNo();
  const own: BlameEntry[] = [{ meddleId: meddle.id, playerId: meddle.playerId, verb: 'dare', landedFact: no, landedAt: now, hops: 0 }];
  // A landing requires nothing in the world: its only Blame is its own Meddle. Playing on a Fear the
  // world already knows him for (it is on his card) is a Callback (D50).
  const { causes, blame } = ctx.link(no, { own, callbacks: fear ? [fear] : [] });
  const head: Fact = {
    no,
    at: now,
    storyNo: no,
    ...(template ? { templateId: template.id, variant } : {}),
    line,
    tier: template ? 'templated' : 'silent',
    cast: victim !== undefined ? [target, victim] : [target],
    causes,
    blame,
    infamy: [],
    kind: 'dare',
    meddleId: meddle.id,
    dareKey: key,
    target,
    ...(victim !== undefined ? { victim } : {}),
    outcome,
    playsOnFear: onFear,
  };
  ctx.facts.push(head);
  ctx.diff.meddles.push({ id: meddle.id, status: 'landed', landedFact: no });
  gainInfamy(ctx, head, target, INFAMY.dare[outcome]);

  // The victim of a Prank that came off (or went wrong on him) now holds it against the target.
  const sting = DARE.sting[outcome];
  if (victim !== undefined && sting !== undefined && def.grudge) {
    holdGrudge(ctx, head, { holder: victim, toward: target, sting, tag: def.grudge, own });
    if (outcome === 'pulled_off') ctx.misfortune(victim, head);
  }

  if (outcome === 'botched') {
    // A botched Dare costs a Warlord the throne, then may kill him, or leave its mark on him.
    warlordFalls(ctx, head, target, 'botched_dare');
    if (rng.chance(DARE.botched.death)) disaster(ctx, head, target, 'botched');
    else if (rng.chance(DARE.botched.humiliation)) humiliate(ctx, head, target, 'botched');
    ctx.misfortune(target, head);
  }
  followUp(ctx, head, 0);
}
