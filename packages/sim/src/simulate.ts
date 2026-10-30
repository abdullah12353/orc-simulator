import type { TemplateDef } from '@orc/content';
import { createRng, type Rng } from './rng.ts';
import type { CaptainId, Fact, Intent, SimResult, StateDiff, WorldState } from './types.ts';

/** Ambient incident odds per tick (D39 / data-model §3 step 5). */
export const AMBIENT_CHANCE = { watched: 1 / 3, unwatched: 1 / 10 } as const;

export function emptyDiff(): StateDiff {
  return {
    world: {},
    captains: [],
    affinity: [],
    grudgeTags: [],
    trophies: { upsert: [] },
    fears: [],
    humiliations: { upsert: [] },
    meddles: [],
    newMeddles: [],
    fuses: { add: [], remove: [] },
    stakes: [],
    ledger: [],
    playerDeltas: [],
    intents: [],
  };
}

/** Mutable scratch for one tick: allocates Fact numbers and collects Facts and the diff. */
class TickContext {
  readonly facts: Fact[] = [];
  readonly diff = emptyDiff();
  readonly state: WorldState;
  readonly rng: Rng;
  private nextNo: number;

  constructor(state: WorldState, rng: Rng) {
    this.state = state;
    this.rng = rng;
    this.nextNo = state.world.nextNo;
  }

  allocNo(): number {
    const no = this.nextNo++;
    this.diff.world.nextNo = this.nextNo;
    return no;
  }

  /** Living active Captains, in slug order (the determinism rule). */
  activeCaptains(): CaptainId[] {
    return Object.keys(this.state.captains)
      .filter((id) => this.state.captains[id]!.roster === 'active')
      .sort();
  }
}

/**
 * One simulation step. Pure: the same state, intents and seed always give the same result.
 * Never touches `Date`, `Math.random` or `crypto`; time comes in only through `state.world.now`.
 */
export function simulate(state: WorldState, intents: Intent[], seed: number): SimResult {
  void intents; // consumed from #28 onwards
  const ctx = new TickContext(state, createRng(seed));
  rollAmbient(ctx);
  return { facts: ctx.facts, stateDiff: ctx.diff };
}

function rollAmbient(ctx: TickContext): void {
  const p = ctx.state.world.watched ? AMBIENT_CHANCE.watched : AMBIENT_CHANCE.unwatched;
  if (!ctx.rng.chance(p)) return;

  const templates = ctx.state.content.templates
    .filter((t) => t.trigger === 'ambient')
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const castable = templates
    .map((t) => ({ t, cast: castRoles(ctx, t) }))
    .filter((c): c is { t: TemplateDef; cast: Record<string, CaptainId> } => c.cast !== null);
  if (castable.length === 0) return;

  const { t, cast } = ctx.rng.pick(castable);
  const outcome = ctx.rng.weighted(t.outcomes, (o) => o.weight);
  const variant = ctx.rng.int(3) as 0 | 1 | 2;
  const no = ctx.allocNo();
  ctx.facts.push({
    no,
    at: ctx.state.world.now,
    storyNo: no,
    templateId: t.id,
    variant,
    line: renderLine(ctx, t.lines[variant], cast),
    tier: 'templated',
    cast: t.roles.map((r) => cast[r.name]!),
    causes: [],
    blame: [],
    infamy: [],
    kind: 'incident',
    trigger: 'ambient',
    roles: cast,
    outcomeKey: outcome.key,
  });
}

/**
 * Picks a distinct active Captain for each role (pinned roles first take their pinned Captain).
 * Returns null if the Template can't be cast right now. Consumes randomness only when castable,
 * after eligibility is known, so the stream stays aligned across equivalent states.
 */
function castRoles(ctx: TickContext, t: TemplateDef): Record<string, CaptainId> | null {
  const active = ctx.activeCaptains();
  const pinned = new Set(t.roles.flatMap((r) => (r.captain ? [r.captain] : [])));
  for (const id of pinned) if (!active.includes(id)) return null;
  const free = active.filter((id) => !pinned.has(id));
  if (free.length < t.roles.filter((r) => !r.captain).length) return null;

  const cast: Record<string, CaptainId> = {};
  for (const role of t.roles) {
    if (role.captain) {
      cast[role.name] = role.captain;
      continue;
    }
    const i = ctx.rng.int(free.length);
    cast[role.name] = free.splice(i, 1)[0]!;
  }
  return cast;
}

function renderLine(ctx: TickContext, line: string, cast: Record<string, CaptainId>): string {
  const names = new Map(ctx.state.content.cast.map((c) => [c.id, c.name]));
  return line.replace(/\{([^}]+)\}/g, (_, role: string) => names.get(cast[role] ?? '') ?? role);
}
