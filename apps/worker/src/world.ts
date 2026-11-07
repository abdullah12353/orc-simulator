// The world's Durable Object (data-model §3, #54): a thin shell over packages/server. It decides "watched"
// from its own state (open sockets, the last request), owns the alarm, opens Postgres for one job at a
// time and closes it after (so it can hibernate), and sends the live hints its work returns to the
// Players' hibernating sockets (#68).
import { DurableObject } from 'cloudflare:workers';
import {
  assertPlayer,
  catchUp,
  connect,
  CORS,
  currentPlayers,
  handleCreateClipping,
  handleCreateWorld,
  handleOpenEdition,
  handleOpenWorld,
  LIVE_PING,
  liveMessage,
  nextMinuteTick,
  OpenWorldError,
  providerKeysFromEnv,
  removedSockets,
  vapidFromEnv,
  WATCH,
  worldTick,
  type LiveHint,
  type LiveMessage,
  type Sql,
} from '@orc/server';
import { USER_HEADER, type Env } from './env.ts';
import { storedGutter } from './gutter.ts';

/** The calls that open Postgres: refused once the gutter is closed (#70). */
const NEON_ACTIONS = new Set(['create', 'open', 'open-edition', 'create-clipping']);

/** What the DO keeps in its own storage (none of it in Postgres). */
interface Stored {
  /** This DO's world (DOs are named by world id, but don't know their name). */
  worldId: string;
  /** Watched until then (ms): 2 min after the last request through the DO, or the last socket's close. */
  watchedUntil: number;
  /** The cron (or create-world) asked for a catch-up, which the next alarm runs. */
  pending: boolean;
  /** create-world asked for a drain: day zero's Clash jobs are waiting for their dialogue. */
  drain: boolean;
}

/** Keep the last this many hints: enough for #68 to send, never a growing pile. */
const KEPT_HINTS = 20;

/** The close code a live socket is refused with while the usage guard has closed the gutter (#55 item 5, #70). */
export const GUTTER_CLOSED_CODE = 4013;
/** The close code for a live socket whose user isn't, or is no longer, one of the world's Players. */
export const NOT_A_PLAYER_CODE = 4003;

/** What each live socket carries through hibernation (`serializeAttachment`). */
interface Attachment {
  userId: string;
}

export class World extends DurableObject<Env> {
  /** One tick-ish job at a time (alarm, open, open-edition), so two never race for the world's row lock. */
  private chain: Promise<unknown> = Promise.resolve();
  /** Live hints from committed work, oldest first. Each went to `ctx.getWebSockets()` as it came. */
  readonly hints: LiveHint[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // A client's pings are answered by the runtime, without waking the object (#55 item 1).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(LIVE_PING.request, LIVE_PING.response));
  }

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
    // Closed (#70): nothing wakes Neon till the 1st, so it never suspends mid-tick.
    if (NEON_ACTIONS.has(action) && (await this.gutter()) === 'closed') {
      return Response.json({ error: 'gutter_closed' }, { status: 503, headers: CORS });
    }
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
      case 'live':
        return this.live(req, worldId, await getUserId());
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
    // The usage guard (#70). Closed: the slots stop too. Slow: no minute ticks, and no next alarm, so a
    // watched world only catches up on the slots like every other.
    const gutter = await this.gutter();
    if (gutter !== 'normal') console.log(`world ${worldId}: the gutter is ${gutter}, ${gutter === 'closed' ? 'no tick' : 'no minute tick'}`);
    if (gutter === 'closed') return;
    const watched = gutter === 'normal' && (await this.watched());
    if (watched) await this.ctx.storage.setAlarm(nextMinuteTick(Date.now()));
    const drain = stored.get('drain') === true;
    if (!watched && stored.get('pending') !== true) return;

    const report = await this.serial(() =>
      this.withSql(async (sql) => {
        await this.closeRemoved(sql, worldId);
        // Each hint goes to the sockets as soon as its work has committed, not after the whole run.
        return worldTick(this.deps(sql), worldId, { watched, drain, onHint: (hint) => this.keep([hint]) });
      }),
    );
    await this.ctx.storage.delete(['pending', 'drain']);
    const steps = report.catchUp.outcomes.filter((o) => o.status === 'stepped').length;
    const tickSeq = report.live?.status === 'stepped' ? report.live.tickSeq : report.catchUp.tickSeq;
    console.log(
      `world ${worldId}: ${watched ? 'watched' : 'unwatched'}, catch-up ${report.catchUp.mode} (${steps} steps)` +
        `${report.live ? `, minute tick ${report.live.status}` : ''}, tick_seq ${tickSeq ?? '-'}, ${report.hints.length} hints`,
    );
  }

  // ---- live sockets (#68) ----

  /**
   * A Player opens the world's live socket (#55). It's refused with a close code while the gutter is
   * closed (before Postgres is touched), or when the user isn't a Player (one query). Otherwise it's
   * accepted as a hibernating socket that carries its user id, and the world catches up and sends
   * `ready` with its tick_seq (#53 item 2).
   */
  private async live(req: Request, worldId: string, userId: string | null): Promise<Response> {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('expected a websocket', { status: 426 });
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    const refuse = (code: number, reason: string) => {
      // Accepted only to carry the close code: not hibernatable, so it never counts as watching.
      server.accept();
      server.close(code, reason);
      return new Response(null, { status: 101, webSocket: client });
    };
    if ((await this.gutter()) === 'closed') return refuse(GUTTER_CLOSED_CODE, 'gutter closed');
    if (!userId || !(await this.isPlayer(worldId, userId))) return refuse(NOT_A_PLAYER_CODE, 'not a player');
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId } satisfies Attachment);
    await this.ctx.storage.put<string>('worldId', worldId);
    // The open socket keeps the world watched (`watched()`); this arms the minute tick.
    await this.watchedByRequest();
    this.ctx.waitUntil(this.ready(server, worldId));
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Membership, in one query: a current (not removed) Player of the world. */
  private isPlayer(worldId: string, userId: string): Promise<boolean> {
    return this.withSql(async (sql) => {
      try {
        await assertPlayer({ sql }, { userId, worldId });
        return true;
      } catch (e) {
        if (e instanceof OpenWorldError) return false;
        throw e;
      }
    });
  }

  /** Catch up, then `ready`. If the catch-up fails, the socket closes and the client reconnects. */
  private async ready(ws: WebSocket, worldId: string): Promise<void> {
    try {
      const { tickSeq } = await this.serial(() => this.withSql((sql) => catchUp(this.deps(sql), worldId)));
      if (tickSeq === null) throw new Error('no such world');
      ws.send(JSON.stringify({ type: 'ready', tick_seq: tickSeq } satisfies LiveMessage));
    } catch (e) {
      console.error(`world ${worldId}: a live socket's catch-up failed`, e);
      try {
        ws.close(1011, 'catch-up failed');
      } catch {
        // already closed
      }
    }
  }

  /** Clients only send pings, which the runtime answers. Anything else is ignored. */
  override async webSocketMessage(): Promise<void> {}

  /** The world stays watched for 2 min after the last socket closes (#55 item 5). */
  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    await this.watchedByRequest();
    try {
      // 1005 and 1006 can't be sent; anything else is echoed to finish the closing handshake.
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      // already closed
    }
  }

  override async webSocketError(): Promise<void> {
    await this.watchedByRequest();
  }

  /** Re-reads the member list (#55 item 3) and closes the sockets of Players removed since they opened. */
  private async closeRemoved(sql: Sql, worldId: string): Promise<void> {
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return;
    const players = await currentPlayers({ sql }, worldId);
    const userOf = (ws: WebSocket) => (ws.deserializeAttachment() as Attachment | null)?.userId ?? null;
    for (const ws of removedSockets(sockets, userOf, players)) {
      try {
        ws.close(NOT_A_PLAYER_CODE, 'not a player');
      } catch {
        // already closed
      }
    }
  }

  /**
   * The usage guard's state (#70), from the cron's last reading in KV: never Postgres. `closed` refuses
   * live sockets with GUTTER_CLOSED_CODE.
   */
  private async gutter(): Promise<'normal' | 'slow' | 'closed'> {
    return storedGutter(this.env);
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

  /** Where the live hints go once their work has committed: every open socket (#68), and the kept list. */
  private keep(hints: LiveHint[]): void {
    this.hints.push(...hints);
    this.hints.splice(0, Math.max(0, this.hints.length - KEPT_HINTS));
    const sockets = this.ctx.getWebSockets();
    for (const hint of hints) {
      const message = JSON.stringify(liveMessage(hint));
      for (const ws of sockets) {
        try {
          ws.send(message);
        } catch {
          // closing: its client refetches when it reconnects
        }
      }
    }
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
