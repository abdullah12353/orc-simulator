// Live watching (#31, #55, #68): one WebSocket per world to its Durable Object, shared by every listener in
// the app. The socket is a nudge, never data: after a watched tick that made Facts the DO sends `tick`,
// after a Clash's generated lines land it sends `dialogue`, and listeners refetch what they show. Every
// (re)open ends in `ready`, once the world has caught up, and that refetches everything. While it's open
// the world is watched, so it's open only while the app is visible (live-socket.ts).
import { useEffect, useRef, useState } from 'react';
import { LIVE, liveConnection, type LiveConnection, type LiveEnv, type SocketLike } from './live-socket.ts';
import { worldGate, type GateView } from './world-gate.ts';
import { WORKER_URL, workerToken } from './worker.ts';

/**
 * A live nudge: `tickSeq` is the tick that made new Facts, or null when the socket (re)opened and
 * anything may have been missed. Either way, refetch.
 */
export type LiveListener = (tickSeq: number | null) => void;

/** A Clash's generated dialogue landed (#37): `factNo` is the Clash. Refetch its `clash_dialogue`. */
export type DialogueListener = (factNo: number) => void;

/** A `ready` came, or the DO closed the socket for good (`stopped` is its close code). */
type StatusListener = (event: { ready: true } | { stopped: number }) => void;

interface Feed {
  connection: LiveConnection;
  listeners: Set<LiveListener>;
  dialogue: Set<DialogueListener>;
  status: Set<StatusListener>;
  /** A `ready` has come on this world's socket since it was first opened. */
  everReady: boolean;
}
const feeds = new Map<string, Feed>();

const browser: LiveEnv = {
  workerUrl: WORKER_URL,
  token: workerToken,
  openSocket: (url) => {
    const ws = new WebSocket(url);
    const socket: SocketLike = {
      onopen: null,
      onmessage: null,
      onclose: null,
      send: (data) => ws.send(data),
      close: (code, reason) => ws.close(code, reason),
    };
    ws.onopen = () => socket.onopen?.();
    ws.onmessage = (ev) => socket.onmessage?.(ev);
    ws.onclose = (ev) => socket.onclose?.(ev);
    return socket;
  },
  visible: () => document.visibilityState === 'visible',
  onVisibilityChange: (callback) => {
    document.addEventListener('visibilitychange', callback);
    return () => document.removeEventListener('visibilitychange', callback);
  },
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (handle) => window.clearInterval(handle as number),
  now: () => Date.now(),
};

/** The world's one shared socket, opened on first use. */
function feedFor(worldId: string): Feed {
  let feed = feeds.get(worldId);
  if (!feed) {
    const listeners = new Set<LiveListener>();
    const dialogue = new Set<DialogueListener>();
    const status = new Set<StatusListener>();
    const connection = liveConnection(worldId, browser, {
      ready: () => {
        if (feed) feed.everReady = true;
        for (const s of status) s({ ready: true });
        for (const l of listeners) l(null);
      },
      stopped: (code) => {
        for (const s of status) s({ stopped: code });
      },
      tick: (tickSeq) => {
        for (const l of listeners) l(tickSeq);
      },
      dialogue: (factNo) => {
        for (const l of dialogue) l(factNo);
      },
    });
    feed = { connection, listeners, dialogue, status, everReady: false };
    feeds.set(worldId, feed);
  }
  return feed;
}

/**
 * A socket nobody listens to stays this long, so a tab switch (one screen's listener goes, the next
 * one's comes) doesn't close and reopen it: every open costs a request and wakes Postgres.
 */
const LINGER_MS = 5_000;

/** Closes the world's socket once nobody has listened to it for a moment. */
function release(worldId: string, feed: Feed): void {
  const unused = () => feed.listeners.size === 0 && feed.dialogue.size === 0 && feed.status.size === 0 && feeds.get(worldId) === feed;
  if (!unused()) return;
  window.setTimeout(() => {
    if (!unused()) return;
    feeds.delete(worldId);
    feed.connection.close();
  }, LINGER_MS);
}

/** Listens to a world's live socket. One socket per world, shared by every listener in the app. */
export function listenLive(worldId: string, listener: LiveListener): () => void {
  const feed = feedFor(worldId);
  feed.listeners.add(listener);
  return () => {
    feed.listeners.delete(listener);
    release(worldId, feed);
  };
}

/** Listens for generated Clash dialogue landing in this world (on the same shared socket). */
export function listenDialogue(worldId: string, listener: DialogueListener): () => void {
  const feed = feedFor(worldId);
  feed.dialogue.add(listener);
  return () => {
    feed.dialogue.delete(listener);
    release(worldId, feed);
  };
}

/** Calls `onDialogue` whenever a Clash's generated lines land (latest callback, stable subscription). */
export function useDialogue(worldId: string, onDialogue: DialogueListener): void {
  const latest = useRef(onDialogue);
  latest.current = onDialogue;
  useEffect(() => listenDialogue(worldId, (no) => latest.current(no)), [worldId]);
}

/** Calls `onNudge` on every live nudge for this world (latest callback, stable subscription). */
export function useLive(worldId: string, onNudge: LiveListener): void {
  const latest = useRef(onNudge);
  latest.current = onNudge;
  useEffect(() => listenLive(worldId, (seq) => latest.current(seq)), [worldId]);
}

export interface WorldOpen {
  /** `waiting` until the socket's `ready` or 4 s, then `ready`, or `stale` (shown, possibly out of date). */
  view: GateView;
  /** The DO refused the socket because the usage guard has closed the gutter (4013). */
  gutterClosed: boolean;
}

/** What the world's shared socket has seen so far, for a screen opening now. */
function seen(worldId: string): { ready: boolean; stoppedBy: number | null } {
  const feed = feeds.get(worldId);
  return { ready: feed?.everReady ?? false, stoppedBy: feed?.connection.stoppedBy() ?? null };
}

/**
 * Opening a world (#53 item 2): connect to its DO first, and hold the screens until `ready`, so what they
 * read is caught up. After 4 s they show anyway, marked possibly stale. A refused socket doesn't wait.
 */
export function useWorldOpen(worldId: string): WorldOpen {
  const initial = (): WorldOpen => {
    const s = seen(worldId);
    return { view: s.ready ? 'ready' : s.stoppedBy !== null ? 'stale' : 'waiting', gutterClosed: s.stoppedBy === LIVE.gutterClosedCode };
  };
  const [open, setOpen] = useState<WorldOpen>(initial);
  useEffect(() => {
    const feed = feedFor(worldId);
    const s = seen(worldId);
    const gate = worldGate(
      { setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: (h) => window.clearTimeout(h as number) },
      (view) => setOpen((o) => ({ ...o, view })),
      { ready: s.ready, stopped: s.stoppedBy !== null },
    );
    setOpen({ view: gate.view(), gutterClosed: s.stoppedBy === LIVE.gutterClosedCode });
    const onStatus: StatusListener = (event) => {
      setOpen((o) => ({ ...o, gutterClosed: 'stopped' in event && event.stopped === LIVE.gutterClosedCode }));
      if ('ready' in event) gate.ready();
      else gate.stopped();
    };
    feed.status.add(onStatus);
    return () => {
      gate.dispose();
      feed.status.delete(onStatus);
      release(worldId, feed);
    };
  }, [worldId]);
  return open;
}
