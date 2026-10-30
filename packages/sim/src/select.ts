// Picking Templates and casts (D47): a Template used in the last 24 h and a pair seen together in the last
// hour count half, and Krúg counts double, so he keeps turning up but the same joke doesn't.
import { KRUG, type TemplateDef } from '@orc/content';
import type { TickContext } from './context.ts';
import type { CaptainId } from './types.ts';

export const SELECTION = {
  /** Krúg's weight when a free role is cast (everyone else counts 1). */
  krug: 2,
  /** Multiplier for a recently used Template or a recently seen pair. */
  recent: 0.5,
} as const;

/** A Template's weight in a pick: halved if it ran in the last 24 h. */
export function templateWeight(ctx: TickContext, t: TemplateDef): number {
  return ctx.recentTemplate(t.id) ? SELECTION.recent : 1;
}

/** The roles that aren't free: pinned, or cast from the parent. Null if one can't be filled right now. */
function fixedRoles(ctx: TickContext, t: TemplateDef, parent: Record<string, CaptainId>): Record<string, CaptainId> | null {
  const fixed: Record<string, CaptainId> = {};
  for (const role of t.roles) {
    if (role.captain === undefined && role.from === undefined) continue;
    const id = role.captain ?? parent[role.from!];
    if (id === undefined || !fits(ctx, id, role.trait)) return null;
    fixed[role.name] = id;
  }
  return new Set(Object.values(fixed)).size === Object.keys(fixed).length ? fixed : null;
}

const fits = (ctx: TickContext, id: CaptainId, trait?: string) =>
  ctx.rosterOf(id) === 'active' && (!trait || ctx.state.captains[id]!.traits.includes(trait));

const freeRoles = (t: TemplateDef) => t.roles.filter((r) => r.captain === undefined && r.from === undefined);

/** Can the Template be cast right now? Spends no randomness. */
export function canCast(ctx: TickContext, t: TemplateDef, parent: Record<string, CaptainId> = {}): boolean {
  const fixed = fixedRoles(ctx, t, parent);
  if (!fixed) return false;
  const taken = new Set(Object.values(fixed));
  const free = freeRoles(t);
  const pools = free.map((r) => ctx.activeCaptains().filter((id) => !taken.has(id) && fits(ctx, id, r.trait)));
  return pools.every((p) => p.length > 0) && new Set(pools.flat()).size >= free.length;
}

/**
 * Casts a distinct active Captain into every role, or returns null if the Template can't be cast now.
 * Pinned roles take their Captain, `from` roles take the parent Fact's Captain in that role, and free roles
 * are drawn weighted: Krúg double, halved per recent pair with anyone already cast. Every role must meet its
 * Trait precondition. Randomness is drawn only once the Template is known to be castable.
 */
export function castRoles(
  ctx: TickContext,
  t: TemplateDef,
  parent: Record<string, CaptainId> = {},
): Record<string, CaptainId> | null {
  if (!canCast(ctx, t, parent)) return null;
  const cast = fixedRoles(ctx, t, parent)!;
  const taken = new Set(Object.values(cast));
  for (const role of freeRoles(t)) {
    const pool = ctx.activeCaptains().filter((id) => !taken.has(id) && fits(ctx, id, role.trait));
    if (pool.length === 0) return null; // Trait preconditions can still collide; rare, and nothing is written
    const id = ctx.rng.weighted(pool, (c) => castWeight(ctx, c, Object.values(cast)));
    cast[role.name] = id;
    taken.add(id);
  }
  return cast;
}

function castWeight(ctx: TickContext, id: CaptainId, alreadyCast: CaptainId[]): number {
  let w = id === KRUG ? SELECTION.krug : 1;
  for (const other of alreadyCast) if (ctx.recentPair(id, other)) w *= SELECTION.recent;
  return w;
}
