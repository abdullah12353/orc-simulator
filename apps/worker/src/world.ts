// The world's Durable Object (data-model §3, #54): a thin shell over packages/server. It decides "watched"
// from its own state (open sockets, the last request), owns the alarm, opens Postgres for one job at a
// time and closes it after (so it can hibernate), and keeps the live hints its work returns.
import { DurableObject } from 'cloudflare:workers';
import {
  connect,
  handleCreateClipping,
  handleCreateWorld,
  handleOpenEdition,
  handleOpenWorld,
  nextMinuteTick,
  providerKeysFromEnv,
  vapidFromEnv,
  WATCH,
  worldTick,
  type LiveHint,
  type Sql,
} from '@orc/server';
import { USER_HEADER, type Env } from './env.ts';

/** What the DO keeps in its own storage (none of it in Postgres). */
interface Stored {
  /** This DO's world (DOs are named by world id, but don't know their name). */
  worldId: string;
  /** Watched until then (ms): 2 min after the last request through the DO. */
  watchedUntil: number;
  /** The cron (or create-world) asked for a catch-up, which the next alarm runs. */
  pending: boolean;
  /** create-world asked for a drain: day zero's Clash jobs are waiting for their dialogue. */
  drain: boolean;
}

/** Keep the last this many hints: enough for #68 to send, never a growing pile. */
const KEPT_HINTS = 20;

export class World extends DurableObject<Env> {
  /** One tick-ish job at a time (alarm, open, open-edition), so two never race for the world's row lock. */
  private chain: Promise<unknown> = Promise.resolve();
  /**
   * Live hints from committed work, oldest first. #68 sends them to `ctx.getWebSockets()`; until then
   * they're only kept.
   */
  readonly hints: LiveHint[] = [];

  // ---- the router's calls ----

  override async fetch(req: Request): Promise<Response> {
    const [, worldId = '', action = ''] = new URL(req.url).pathname.split('/');
    const userId = req.headers.get(USER_HEADER);
    const res = await this.handle(action, req, worldId, async () => userId);
    // Only a call that worked makes the world watched: a stranger's refused open wakes nothing.
    if (res.ok) {
      await this.ctx.storage.put<string>('worldId', worldId);
      await this.watchedByRequest();
    }
    return res;
  }

  private async handle(action: string, req: Request, worldId: string, getUserId: () => Promise<string | null>): Promise<Response> {
    switch (action) {
      case 'create': {
        const res = await this.withSql((sql) =>
          handleCreateWorld(req, { ...this.deps(sql), randomSeed: () => crypto.getRandomValues(new Uint32Array(1))[0]!, getUserId, worldId }),
        );
        if (res.status === 201) {
          await this.env.WORLDS.put(`world:${worldId}`, new Date().toISOString());
          // Day zero left a Clash job per Clash: the alarm drains them, after this answer.
          await this.ctx.storage.put({ worldId, pending: true, drain: true });
          await this.ctx.storage.setAlarm(Date.now());
        }
        return res;
      }
      case 'open':
        return this.serial(() => this.withSql((sql) => handleOpenWorld(req, { ...this.deps(sql), getUserId, worldId })));
      case 'open-edition':
        return this.serial(() =>
          this.withSql((sql, waitUntil) => handleOpenEdition(req, { ...this.deps(sql), getUserId, worldId, waitUntil })),
        );
      case 'create-clipping':
        return this.withSql((sql) => handleCreateClipping(req, { ...this.deps(sql), getUserId, worldId }));
      default:
        return new Response('not found', { status: 404 });
    }
  }

  /**
   * The cron's call (#54 item 4): catch up now. It also restarts a watched world whose alarm died, since
   * the alarm that runs the catch-up re-arms the minute ticks.
   */
  async wake(worldId: string): Promise<void> {
    await this.ctx.storage.put({ worldId, pending: true });
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > Date.now()) await this.ctx.storage.setAlarm(Date.now());
  }

  // ---- the clock ----

  /**
   * Watched: the minute tick, and the next one armed first, so a failed run doesn't end the loop.
   * Unwatched: only a catch-up someone asked for (the cron, create-world), and no next alarm. An idle,
   * unwatched world's alarm never wakes Postgres. A run that throws is retried by the runtime, and every
   * step is idempotent, so a retry only does what's left.
   */
  override async alarm(): Promise<void> {
    const stored = await this.ctx.storage.get<Stored[keyof Stored]>(['worldId', 'pending', 'drain']);
    const worldId = stored.get('worldId') as string | undefined;
    if (!worldId) return;
    const watched = await this.watched();
    if (watched) await this.ctx.storage.setAlarm(nextMinuteTick(Date.now()));
    const drain = stored.get('drain') === true;
    if (!watched && stored.get('pending') !== true) return;

    const report = await this.serial(() => this.withSql((sql) => worldTick(this.deps(sql), worldId, { watched, drain })));
    await this.ctx.storage.delete(['pending', 'drain']);
    this.keep(report.hints);
    const steps = report.catchUp.outcomes.filter((o) => o.status === 'stepped').length;
    const tickSeq = report.live?.status === 'stepped' ? report.live.tickSeq : report.catchUp.tickSeq;
    console.log(
      `world ${worldId}: ${watched ? 'watched' : 'unwatched'}, catch-up ${report.catchUp.mode} (${steps} steps)` +
        `${report.live ? `, minute tick ${report.live.status}` : ''}, tick_seq ${tickSeq ?? '-'}, ${report.hints.length} hints`,
    );
  }

  // ---- watching ----

  /** A Player's socket is open (#68), or a request came through in the last 2 min. */
  private async watched(): Promise<boolean> {
    if (this.ctx.getWebSockets().length > 0) return true;
    return ((await this.ctx.storage.get<number>('watchedUntil')) ?? 0) > Date.now();
  }

  /** A request makes the world watched for 2 min, and arms the minute tick if it isn't already. */
  private async watchedByRequest(): Promise<void> {
    await this.ctx.storage.put<number>('watchedUntil', Date.now() + WATCH.windowMs);
    const next = nextMinuteTick(Date.now());
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > next) await this.ctx.storage.setAlarm(next);
  }

  /** Where the live hints go once their work has committed. #68 sends them to the world's sockets. */
  private keep(hints: LiveHint[]): void {
    this.hints.push(...hints);
    this.hints.splice(0, Math.max(0, this.hints.length - KEPT_HINTS));
  }

  // ---- plumbing ----

  private serial<T>(job: () => Promise<T>): Promise<T> {
    const run = this.chain.then(job, job);
    this.chain = run.catch(() => {});
    return run;
  }

  /**
   * One Postgres connection for one job, closed after it (#65: `sql.end` lets the DO hibernate). Work the
   * job hands to `waitUntil` (open-edition's Herald call) keeps the connection until it finishes.
   */
  private async withSql<T>(job: (sql: Sql, waitUntil: (work: Promise<unknown>) => void) => Promise<T>): Promise<T> {
    const sql = connect(this.env.NEON_DB_URL, { max: 1 });
    const background: Promise<unknown>[] = [];
    try {
      return await job(sql, (work) => void background.push(work));
    } finally {
      const close = Promise.allSettled(background).then(() => sql.end({ timeout: 5 }));
      if (background.length > 0) this.ctx.waitUntil(close);
      else await close;
    }
  }

  private deps(sql: Sql) {
    // Workers' fetch must be called unbound from the global, never as a method of another object.
    const fetcher: typeof fetch = (input, init) => fetch(input, init);
    return {
      sql,
      now: () => new Date(),
      narration: { fetch: fetcher, providers: providerKeysFromEnv(this.env) },
      pushes: { fetch: fetcher, vapid: vapidFromEnv((name) => this.env[name as keyof Env] as string | undefined) },
    };
  }
}
