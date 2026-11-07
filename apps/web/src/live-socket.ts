// One world's live socket to its Durable Object (#55, #68), with no browser globals so it runs under
// node --test. The socket is open only while the app is visible. It reconnects with backoff, and every
// open ends in the DO's `ready` (sent once the world has caught up), which is the cue to refetch. A
// gutter-closed or not-a-Player close stops the retrying.

export const LIVE = {
  /** The DO's close code while the usage guard has closed the gutter (apps/worker GUTTER_CLOSED_CODE, #70). */
  gutterClosedCode: 4013,
  /** The DO's close code for a user who isn't, or is no longer, a Player of the world. */
  notAPlayerCode: 4003,
  /** Reconnects wait 1 s, then double, up to 30 s (#55 item 5). */
  firstRetryMs: 1_000,
  maxRetryMs: 30_000,
  /** A ping this often; the runtime answers `pong` without waking the DO. */
  pingMs: 30_000,
  /** Nothing heard for this long (two pings unanswered): the socket is dead, so reconnect. */
  silentMs: 75_000,
} as const;

/** The delay before reconnect number `attempt` (0-based): 1 s, 2 s, 4 s, … capped at 30 s. */
export const retryDelay = (attempt: number) => Math.min(LIVE.maxRetryMs, LIVE.firstRetryMs * 2 ** attempt);

/** What the DO sends (packages/server `LiveMessage`). */
type Message = { type: 'ready'; tick_seq: number } | { type: 'tick'; tick_seq: number } | { type: 'dialogue'; fact_no: number };

/** The part of a browser WebSocket this uses. */
export interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** What the connection needs from its surroundings: the browser in live.ts, fakes in the tests. */
export interface LiveEnv {
  /** The Worker's origin, e.g. `https://orc-worker.example.workers.dev`. */
  workerUrl: string;
  /** The current JWT (#52), fetched fresh for every open; null when signed out. */
  token: () => Promise<string | null>;
  openSocket: (url: string) => SocketLike;
  visible: () => boolean;
  /** Calls back on every visibility change; returns the unsubscribe. */
  onVisibilityChange: (callback: () => void) => () => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  now: () => number;
}

export interface LiveHandlers {
  /** The socket (re)opened and the world has caught up to `tickSeq`: refetch everything. */
  ready: (tickSeq: number) => void;
  /** A productive watched tick committed. */
  tick: (tickSeq: number) => void;
  /** A Clash's generated dialogue committed. */
  dialogue: (factNo: number) => void;
  /** The DO closed the socket for good: `code` is gutter closed (4013) or not a Player (4003). */
  stopped?: (code: number) => void;
}

/**
 * `hidden`: closed while the app isn't visible. `waiting`: a reconnect is scheduled. `stopped`: the DO
 * closed it for good (gutter closed, or not a Player); a return to visible tries once more.
 */
export type LiveState = 'connecting' | 'open' | 'hidden' | 'waiting' | 'stopped' | 'closed';

export interface LiveConnection {
  state: () => LiveState;
  /** Why it stopped: the DO's close code, when it's `stopped`. */
  stoppedBy: () => number | null;
  close: () => void;
}

/** Opens a world's live socket and keeps it open while the app is visible. */
export function liveConnection(worldId: string, env: LiveEnv, handlers: LiveHandlers): LiveConnection {
  let state: LiveState = 'connecting';
  let stoppedBy: number | null = null;
  let socket: SocketLike | null = null;
  let attempt = 0;
  let retry: unknown = null;
  let ping: unknown = null;
  let heard = 0;
  /** Bumped by every open and every close of ours, so a stale callback knows it's stale. */
  let generation = 0;

  const stopTimers = () => {
    if (retry !== null) env.clearTimeout(retry);
    if (ping !== null) env.clearInterval(ping);
    retry = ping = null;
  };

  const drop = (code: number, reason: string) => {
    const s = socket;
    socket = null;
    generation++;
    stopTimers();
    if (!s) return;
    s.onopen = s.onmessage = s.onclose = null;
    try {
      s.close(code, reason);
    } catch {
      // already closing
    }
  };

  const scheduleRetry = () => {
    state = 'waiting';
    retry = env.setTimeout(() => {
      retry = null;
      void open();
    }, retryDelay(attempt++));
  };

  const open = async () => {
    const mine = ++generation;
    state = 'connecting';
    let token: string | null = null;
    try {
      token = await env.token();
    } catch {
      token = null;
    }
    if (mine !== generation) return; // hidden or closed while the token came
    if (!token) return scheduleRetry();

    const s = env.openSocket(`${env.workerUrl}/worlds/${worldId}/live?token=${encodeURIComponent(token)}`);
    socket = s;
    s.onopen = () => {
      state = 'open';
      heard = env.now();
      ping = env.setInterval(() => {
        if (env.now() - heard > LIVE.silentMs) {
          // Two pings unanswered: the connection died without a close (sleep, a network change).
          drop(1000, 'silent');
          scheduleRetry();
          return;
        }
        try {
          s.send('ping');
        } catch {
          // closing: onclose follows
        }
      }, LIVE.pingMs);
    };
    s.onmessage = (ev) => {
      heard = env.now();
      if (typeof ev.data !== 'string' || ev.data === 'pong') return;
      let m: Message;
      try {
        m = JSON.parse(ev.data) as Message;
      } catch {
        return;
      }
      if (m.type === 'ready' && Number.isFinite(m.tick_seq)) {
        attempt = 0; // a full open: the next drop retries after 1 s again
        handlers.ready(m.tick_seq);
      } else if (m.type === 'tick' && Number.isFinite(m.tick_seq)) handlers.tick(m.tick_seq);
      else if (m.type === 'dialogue' && Number.isFinite(m.fact_no)) handlers.dialogue(m.fact_no);
    };
    s.onclose = (ev) => {
      if (socket !== s) return;
      socket = null;
      stopTimers();
      if (ev.code === LIVE.gutterClosedCode || ev.code === LIVE.notAPlayerCode) {
        state = 'stopped';
        stoppedBy = ev.code;
        handlers.stopped?.(ev.code);
        return;
      }
      scheduleRetry();
    };
  };

  const onVisibility = () => {
    if (state === 'closed') return;
    if (!env.visible()) {
      // Hidden: close, so the world stops being watched 2 min from now (#55 item 5).
      drop(1000, 'hidden');
      state = 'hidden';
    } else if (state === 'hidden' || state === 'stopped' || state === 'waiting') {
      // Visible again: open now (a fresh start, so the backoff resets); `ready` makes the screens refetch.
      drop(1000, 'reopening');
      attempt = 0;
      stoppedBy = null;
      void open();
    }
  };
  const unsubscribe = env.onVisibilityChange(onVisibility);

  if (env.visible()) void open();
  else state = 'hidden';

  return {
    state: () => state,
    stoppedBy: () => stoppedBy,
    close: () => {
      unsubscribe();
      drop(1000, 'done');
      state = 'closed';
    },
  };
}
