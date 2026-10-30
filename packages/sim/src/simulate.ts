import type { TemplateDef } from '@orc/content';
import { weighStories } from './comedy.ts';
import { TickContext } from './context.ts';
import { rollDay } from './day.ts';
import { createRng } from './rng.ts';
import { consumeIntents, fireDueFuses, renderLine } from './rumours.ts';
import type { CaptainId, Intent, SimResult } from './types.ts';
import type { WorldState } from './types.ts';

export { emptyDiff } from './context.ts';

/** Ambient incident odds per tick (D39 / data-model §3 step 5). */
export const AMBIENT_CHANCE = { watched: 1 / 3, unwatched: 1 / 10 } as const;

/**
 * One simulation step. Pure: the same state, intents and seed always give the same result.
 * Never touches `Date`, `Math.random` or `crypto`; time comes in only through `state.world.now`.
 *
 * Order: the day roll, Players' Intents, due Fuses, then one ambient roll. Only one ambient roll
 * per call, however long the world was down: missed ticks are never back-filled.
 */
export function simulate(state: WorldState, intents: Intent[], seed: number): SimResult {
  const ctx = new TickContext(state, createRng(seed));
  rollDay(ctx);
  consumeIntents(ctx, intents);
  fireDueFuses(ctx);
  rollAmbient(ctx);
  ctx.finish();
  weighStories(state, ctx.facts);
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
