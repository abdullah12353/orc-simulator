import type { TemplateDef } from '@orc/content';
import { rollGrudgeClashes } from './clash.ts';
import { weighStories } from './comedy.ts';
import { TickContext } from './context.ts';
import { rollDay } from './day.ts';
import { followUp } from './reactions.ts';
import { createRng } from './rng.ts';
import { consumeIntents, fireDueFuses, renderLine } from './rumours.ts';
import { canCast, castRoles, templateWeight } from './select.ts';
import type { CaptainId, Intent, SimResult } from './types.ts';
import type { WorldState } from './types.ts';

export { emptyDiff } from './context.ts';

/** Ambient incident odds per tick (D39 / data-model §3 step 5). */
export const AMBIENT_CHANCE = { watched: 1 / 3, unwatched: 1 / 10 } as const;

/**
 * One simulation step. Pure: the same state, intents and seed always give the same result.
 * Never touches `Date`, `Math.random` or `crypto`; time comes in only through `state.world.now`.
 *
 * Order: the day roll, Players' Intents, due Fuses, one ambient roll, then the Grudge Clash roll. Each
 * story head sets off its reactions (up to 3 deep) as soon as it's written. Only one ambient roll per
 * call, however long the world was down: missed ticks are never back-filled.
 */
export function simulate(state: WorldState, intents: Intent[], seed: number): SimResult {
  const ctx = new TickContext(state, createRng(seed));
  rollDay(ctx);
  consumeIntents(ctx, intents);
  fireDueFuses(ctx);
  rollAmbient(ctx);
  rollGrudgeClashes(ctx);
  ctx.finish();
  weighStories(state, ctx.facts, ctx.callbacks);
  return { facts: ctx.facts, stateDiff: ctx.diff };
}

/** One ambient incident: a Template picked with the variety rule (recent ones count half), then cast. */
function rollAmbient(ctx: TickContext): void {
  const p = ctx.state.world.watched ? AMBIENT_CHANCE.watched : AMBIENT_CHANCE.unwatched;
  if (!ctx.rng.chance(p)) return;

  const templates = ctx.state.content.templates
    .filter((t) => t.trigger === 'ambient')
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const castable = templates.filter((t) => canCast(ctx, t));
  if (castable.length === 0) return;

  const t: TemplateDef = ctx.rng.weighted(castable, (x) => templateWeight(ctx, x));
  const cast = castRoles(ctx, t)!;
  const outcome = ctx.rng.weighted(t.outcomes, (o) => o.weight);
  const variant = ctx.rng.int(3) as 0 | 1 | 2;
  const no = ctx.allocNo();
  const fact = {
    no,
    at: ctx.state.world.now,
    storyNo: no,
    templateId: t.id,
    variant,
    line: renderLine(ctx, t.lines[variant], cast),
    tier: 'templated' as const,
    cast: t.roles.map((r) => cast[r.name]!) as CaptainId[],
    ...ctx.link(no, {}), // ambient: nothing required, so no causes and no Blame
    infamy: [],
    kind: 'incident' as const,
    trigger: 'ambient' as const,
    roles: cast,
    outcomeKey: outcome.key,
  };
  ctx.facts.push(fact);
  followUp(ctx, fact, 0);
}
