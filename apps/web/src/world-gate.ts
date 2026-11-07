// Connect, then read (#53 item 2). When a world opens, its screens wait for the live socket's `ready`: the
// DO has caught the world up, so nothing is shown up to 30 min behind. If `ready` hasn't come within 4 s
// (the Worker or the network is down, or the DO refused the socket), the screens load anyway, marked
// possibly stale, while the socket keeps retrying; a late `ready` clears the mark and refetches. Writes
// never wait for this. Pure, with injected timers, so it's tested in apps/web/test.

/** How long the screens wait for `ready` before loading anyway. */
export const READY_WAIT_MS = 4_000;

/** `waiting`: show nothing yet. `ready`: show the screens. `stale`: show them, marked possibly out of date. */
export type GateView = 'waiting' | 'ready' | 'stale';

export interface GateTimers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface WorldGate {
  view: () => GateView;
  /** The socket's `ready` arrived. */
  ready: () => void;
  /** The DO closed the socket for good (gutter closed, not a Player): no `ready` is coming, so don't wait. */
  stopped: () => void;
  dispose: () => void;
}

/** `already`: what the world's shared socket has seen before this screen opened. */
export function worldGate(
  timers: GateTimers,
  onChange: (view: GateView) => void,
  already: { ready: boolean; stopped: boolean } = { ready: false, stopped: false },
  waitMs = READY_WAIT_MS,
): WorldGate {
  let view: GateView = already.ready ? 'ready' : already.stopped ? 'stale' : 'waiting';
  let timer: unknown = null;
  const set = (next: GateView) => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
    if (next === view) return;
    view = next;
    onChange(next);
  };
  if (view === 'waiting') {
    timer = timers.setTimeout(() => {
      timer = null;
      set('stale');
    }, waitMs);
  }
  return {
    view: () => view,
    ready: () => set('ready'),
    stopped: () => {
      if (view === 'waiting') set('stale');
    },
    dispose: () => {
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    },
  };
}
