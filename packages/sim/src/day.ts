// The day roll at midnight Europe/London (data-model decision 12): allowances accrue for everyone at
// once, the death counter resets and affinity cools. One roll per London day, however long the world
// was down. The Stipend joins it with Backing (#36).
import type { TickContext } from './context.ts';
import { londonDate } from './time.ts';

export const DAY_ROLL = {
  /** Meddles granted per Player (banked up to MEDDLE_CAP). */
  meddles: 3,
  /** How far every affinity drifts towards 0 per day (D49). */
  drift: 5,
} as const;

export function rollDay(ctx: TickContext): void {
  const today = londonDate(ctx.state.world.now);
  if (today === ctx.state.world.day) return;
  ctx.diff.world.day = today;
  if (ctx.state.world.deathsToday !== 0) ctx.diff.world.deathsToday = 0;

  for (const playerId of Object.keys(ctx.state.players).sort()) ctx.addMeddles(playerId, DAY_ROLL.meddles);

  for (const [holder, toward] of ctx.affinityPairs()) {
    const v = ctx.getAffinity(holder, toward);
    ctx.setAffinity(holder, toward, Math.sign(v) * Math.max(0, Math.abs(v) - DAY_ROLL.drift));
  }
}
