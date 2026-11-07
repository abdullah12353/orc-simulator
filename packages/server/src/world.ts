// What the world's Durable Object runs (data-model §3, #54). The DO class in apps/worker is a thin shell:
// it decides "watched" from memory, owns the alarm and the Postgres connection's lifetime, and calls
// these. Everything here is runtime-neutral, so Seam B tests it in Node.
import { drainJobs, type NarrationDeps } from './narration/index.ts';
import { drainPushes, type PushDeps } from './pushes.ts';
import type { LiveHint } from './realtime.ts';
import { CADENCE, tickWorld, type TickDeps, type TickOutcome } from './tick.ts';

export const CATCH_UP = {
  /** One unwatched sim step (D39). */
  stepMs: CADENCE.unwatchedMs,
  /** A gap this many steps long (6 h) or shorter is replayed step by step; a longer one is decision 15(a). */
  maxReplaySteps: 72,
} as const;

/**
 * Watching (data-model §3 step 1, #54 item 3): a world is watched while a Player's live socket is open,
 * and for this long after the last socket closes or the last request came through its DO.
 */
export const WATCH = { windowMs: 2 * 60_000 } as const;

/** When a watched world's next minute tick is due: just past the top of the next minute. */
export const nextMinuteTick = (nowMs: number) => (Math.floor(nowMs / CADENCE.watchedMs) + 1) * CADENCE.watchedMs + 1_000;

export interface CatchUpReport {
  /**
   * `none`: nothing was due. `replay`: the missed steps ran one by one, each backdated to its own time.
   * `jump`: the gap was over `maxReplaySteps`, so one step ran at now (decision 15(a)). `not_found`: no such world.
   */
  mode: 'none' | 'replay' | 'jump' | 'not_found';
  /** The outcome of every step tried, in order. A run stops at the first that didn't step (`busy`, `idle`). */
  outcomes: TickOutcome[];
  /** The world's tick_seq afterwards (null if it doesn't exist). */
  tickSeq: number | null;
}

/**
 * Runs the 5-minute steps an unwatched world missed since its last tick, up to now (#54 item 2). Steps
 * land at `last_tick_at + 5 min`, `+ 10 min`, … so they are the steps a live clock would have run, and
 * each consumes only the Intents submitted by its own time. Over 72 missed steps it runs one step at
 * now instead (decision 15(a)): overdue Fuses, Returns and expiries fire, and ambient rolls aren't
 * back-filled. Idempotent: a re-run finds nothing due.
 */
export async function catchUp(deps: TickDeps, worldId: string): Promise<CatchUpReport> {
  const world = await lastTick(deps, worldId);
  if (!world) return { mode: 'not_found', outcomes: [], tickSeq: null };
  const now = deps.now().getTime();
  const last = Date.parse(world.last_tick_at);
  const missed = Math.floor((now - last) / CATCH_UP.stepMs);
  if (missed < 1) return { mode: 'none', outcomes: [], tickSeq: world.tick_seq };

  const outcomes: TickOutcome[] = [];
  if (missed > CATCH_UP.maxReplaySteps) {
    outcomes.push(await tickWorld(deps, worldId, { at: new Date(now) }));
  } else {
    for (let k = 1; k <= missed; k++) {
      const out = await tickWorld(deps, worldId, { at: new Date(last + k * CATCH_UP.stepMs) });
      outcomes.push(out);
      if (out.status !== 'stepped') break;
    }
  }
  const mode = missed > CATCH_UP.maxReplaySteps ? 'jump' : 'replay';
  return { mode, outcomes, tickSeq: (await lastTick(deps, worldId))?.tick_seq ?? null };
}

async function lastTick(deps: Pick<TickDeps, 'sql'>, worldId: string) {
  const [w] = await deps.sql<{ tick_seq: number; last_tick_at: string }[]>`
    select tick_seq::int, to_json(last_tick_at)#>>'{}' as last_tick_at from worlds where id = ${worldId}`;
  return w;
}

export interface WorldTickDeps extends Omit<TickDeps, 'watched'> {
  /** Narration's providers. Without it, Clash jobs stay queued for a later drain. */
  narration?: Pick<NarrationDeps, 'fetch' | 'providers' | 'timeoutMs'>;
  /** Web Push (#42). Without it, or with `vapid: null`, queued pushes are never sent (they go stale). */
  pushes?: Pick<PushDeps, 'fetch' | 'vapid'>;
}

export interface WorldTickReport {
  catchUp: CatchUpReport;
  /** The watched minute step, when the world is watched. */
  live: TickOutcome | null;
  /** Live hints, in order, each for work that has committed (#55 item 2). Sending them is the DO's job. */
  hints: LiveHint[];
}

/**
 * One run of the world's clock (the DO's alarm, data-model §3 steps 1–7): catch up the missed unwatched
 * steps, then, if the world is watched, the minute step at the top of the current minute (so a retried
 * alarm in the same minute finds it done). After the commits it sends the world's queued pushes and
 * drains its narration jobs, when anything stepped or `drain` asks for it (after create-world, for day
 * zero's Clash jobs). Pushes first: they're quick, and late ones are worse than late dialogue.
 */
export async function worldTick(
  deps: WorldTickDeps,
  worldId: string,
  opts: { watched: boolean; drain?: boolean },
): Promise<WorldTickReport> {
  const caughtUp = await catchUp(deps, worldId);
  let live: TickOutcome | null = null;
  if (opts.watched && caughtUp.mode !== 'not_found') {
    const minute = Math.floor(deps.now().getTime() / CADENCE.watchedMs) * CADENCE.watchedMs;
    live = await tickWorld({ ...deps, now: () => new Date(minute), watched: () => true }, worldId);
  }
  const outcomes = live ? [...caughtUp.outcomes, live] : caughtUp.outcomes;
  const hints = outcomes.flatMap((o) => (o.status === 'stepped' && o.hint ? [o.hint] : []));

  if (outcomes.some((o) => o.status === 'stepped') || opts.drain) {
    if (deps.pushes?.vapid) {
      await drainPushes({ ...deps.pushes, sql: deps.sql, now: deps.now }, { worldIds: [worldId] }).catch((e: unknown) =>
        console.error('drainPushes failed', e),
      );
    }
    if (deps.narration) {
      const report = await drainJobs(
        { ...deps.narration, sql: deps.sql, now: deps.now, content: deps.content, watched: () => opts.watched },
        { worldIds: [worldId] },
      ).catch((e: unknown) => {
        console.error('drainJobs failed', e);
        return null;
      });
      hints.push(...(report?.hints.map((h) => h.hint) ?? []));
    }
  }
  return { catchUp: caughtUp, live, hints };
}

/** A refusal with a machine-readable reason as its message (`not_a_player`). */
export class OpenWorldError extends Error {}

/**
 * A Player opens a world (#53 item 2): it catches up first, so the screens never read a world up to 30
 * minutes behind. Only for the world's own Players. Returns the tick_seq the screens will see (what
 * #68's `ready` carries).
 */
export async function openWorld(deps: TickDeps, input: { userId: string; worldId: string }): Promise<{ tickSeq: number }> {
  await assertPlayer(deps, input);
  const caughtUp = await catchUp(deps, input.worldId);
  return { tickSeq: caughtUp.tickSeq! };
}

/** Throws `OpenWorldError('not_a_player')` unless the user is a current Player of the world. */
export async function assertPlayer(deps: Pick<TickDeps, 'sql'>, input: { userId: string; worldId: string }): Promise<void> {
  const [player] = await deps.sql`
    select 1 from players where world_id = ${input.worldId} and user_id = ${input.userId} and removed_at is null`;
  if (!player) throw new OpenWorldError('not_a_player');
}
