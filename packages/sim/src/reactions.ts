// Reaction chains (D47): a story head can set off a reaction Template, which can set off another, up to 3
// deep inside one tick. The next link goes onto a 5–30 minute Fuse, so long chains unfold across visits.
// Cascades emerge from this; nothing scripts them (D14).
//
// The seam: anything that writes a story head calls `followUp(ctx, head, depth)` once the head and its
// consequences are in. A Fact kind joins in by offering roles in `parentRoles` (named in `PARENT_ROLES`).
// A head that isn't itself a reaction (a Return, a death's stepping in) takes the depth of whatever set it off.
import type { ParentKind, PARENT_ROLES, TemplateDef } from '@orc/content';
import { resolveClash } from './clash.ts';
import type { TickContext } from './context.ts';
import { outcomeInfamy } from './infamy.ts';
import { disaster } from './roster.ts';
import { renderLine } from './rumours.ts';
import { castRoles } from './select.ts';
import { addMinutes } from './time.ts';
import type { CaptainId, Cause, Fact, Fuse } from './types.ts';

export const REACTIONS = {
  /** Reactions chain at most this deep inside one tick. */
  maxDepth: 3,
  /** The link past that goes onto a Fuse of this many minutes (inclusive). */
  fuse: { min: 5, max: 30 },
} as const;

interface Parent {
  roles: Record<string, CaptainId>;
  /** What a reaction's `after.outcomes` matches; null for a head without outcomes (a Return, a crowning). */
  outcome: string | null;
}

/** Every role `PARENT_ROLES` names for this kind, and only those (one the Fact doesn't fill is left out). */
type Offered<K extends ParentKind> = { [R in (typeof PARENT_ROLES)[K][number]]: CaptainId | null | undefined };

function offer<K extends ParentKind>(roles: Offered<K>, outcome: string | null): Parent {
  const filled: Record<string, CaptainId> = {};
  for (const [name, id] of Object.entries(roles) as [string, CaptainId | null | undefined][]) if (id) filled[name] = id;
  return { roles: filled, outcome };
}

/** The roles a Fact offers its reactions, and its outcome; null for kinds nothing reacts to. */
export function parentRoles(f: Fact): Parent | null {
  switch (f.kind) {
    case 'incident':
      return { roles: f.roles, outcome: f.outcomeKey };
    case 'rumour':
      return offer<'rumour'>({ source: f.source, target: f.intended, reached: f.reached }, f.outcome);
    case 'clash':
      return offer<'clash'>({ a: f.a, b: f.b, winner: f.winner, loser: f.loser, saviour: f.saviour }, f.outcome);
    case 'dare':
      return offer<'dare'>({ target: f.target, victim: f.victim }, f.outcome);
    case 'return':
      return offer<'return'>({ returner: f.intro.captainId }, null);
    case 'stepped_in':
      return offer<'stepped_in'>({ newcomer: f.intro.captainId, dead: f.replacing }, null);
    case 'unmasked':
      return offer<'unmasked'>({ captain: f.captainId }, f.by);
    case 'crowned':
      return offer<'crowned'>({ warlord: f.intro.captainId, previous: f.previous }, null);
    default:
      return null;
  }
}

/**
 * Lets the world react to `head` (at reaction depth `depth`; 0 for anything that isn't itself a reaction).
 * Matching reaction Templates are tried in slug order and the first that can be cast and wins its chance
 * fires: at most one reaction per head. Past depth 3 it is put on a Fuse instead.
 */
export function followUp(ctx: TickContext, head: Fact, depth: number): void {
  const parent = parentRoles(head);
  if (!parent) return;
  const templates = ctx.state.content.templates
    .filter((t) => t.trigger === 'reaction' && t.after?.kind === head.kind)
    .filter((t) => !t.after!.outcomes || (parent.outcome !== null && t.after!.outcomes.includes(parent.outcome)))
    .sort((x, y) => (x.id < y.id ? -1 : 1));
  for (const t of templates) {
    const cast = castRoles(ctx, t, parent.roles);
    if (!cast || !ctx.rng.chance(t.after!.chance)) continue;
    const cause: Cause = { fact: head.no, blame: head.blame };
    if (depth + 1 > REACTIONS.maxDepth) {
      const { min, max } = REACTIONS.fuse;
      const fuse: Fuse = {
        no: ctx.allocNo(),
        dueAt: addMinutes(ctx.state.world.now, min + ctx.rng.int(max - min + 1)),
        reaction: { templateId: t.id, cast, parent: cause },
      };
      ctx.diff.fuses.add.push(fuse);
    } else {
      react(ctx, t, cast, cause, depth + 1);
    }
    return;
  }
}

/** A reaction that was put on a Fuse comes due: it fires as the first link of this tick's chain. */
export function fireReactionFuse(ctx: TickContext, fuse: Fuse & { reaction: NonNullable<Fuse['reaction']> }): void {
  const { templateId, cast, parent } = fuse.reaction;
  const t = ctx.state.content.templates.find((x) => x.id === templateId);
  const active = new Set(ctx.activeCaptains());
  // Its cast may have died, been benched or vanished from the bundle since: then it quietly never happens.
  if (!t || !Object.values(cast).every((id) => active.has(id))) return;
  react(ctx, t, cast, parent, 1);
}

/** Runs one reaction Template at `depth`: a forced Clash, or a reaction incident. Either can chain on. */
function react(ctx: TickContext, t: TemplateDef, cast: Record<string, CaptainId>, parent: Cause, depth: number): void {
  if (t.kind === 'clash') {
    resolveClash(ctx, { template: t, a: cast.a!, b: cast.b!, trigger: 'forced', requires: [parent], depth });
    return;
  }
  const outcome = ctx.rng.weighted(t.outcomes, (o) => o.weight);
  const variant = ctx.rng.int(3) as 0 | 1 | 2;
  const no = ctx.allocNo();
  const fact: Fact = {
    no,
    at: ctx.state.world.now,
    storyNo: no,
    templateId: t.id,
    variant,
    line: renderLine(ctx, t.lines[variant], cast),
    tier: 'templated',
    cast: t.roles.map((r) => cast[r.name]!),
    // A reaction requires the Fact it reacts to, so Blame carries one hop on.
    ...ctx.link(no, { requires: [parent] }),
    infamy: [],
    kind: 'incident',
    trigger: 'reaction',
    roles: cast,
    outcomeKey: outcome.key,
  };
  ctx.facts.push(fact);
  outcomeInfamy(ctx, fact, outcome, cast);
  if (outcome.death) disaster(ctx, fact, cast[outcome.death.role]!, outcome.death.tag, depth);
  followUp(ctx, fact, depth);
}
