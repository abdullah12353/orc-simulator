// Live watching (#31, #55, #68): one WebSocket per world to its Durable Object, shared by every listener in
// the app. The socket is a nudge, never data: after a watched tick that made Facts the DO sends `tick`,
// after a Clash's generated lines land it sends `dialogue`, and listeners refetch what they show. Every
// (re)open ends in `ready`, once the world has caught up, and that refetches everything. While it's open
// the world is watched, so it's open only while the app is visible (live-socket.ts).
import { useEffect, useRef } from 'react';
import { liveConnection, type LiveConnection, type LiveEnv, type SocketLike } from './live-socket.ts';
import { WORKER_URL, workerToken } from './worker.ts';

/**
 * A live nudge: `tickSeq` is the tick that made new Facts, or null when the socket (re)opened and
 * anything may have been missed. Either way, refetch.
 */
export type LiveListener = (tickSeq: number | null) => void;

/** A Clash's generated dialogue landed (#37): `factNo` is the Clash. Refetch its `clash_dialogue`. */
export type DialogueListener = (factNo: number) => void;

interface Feed {
  connection: LiveConnection;
  listeners: Set<LiveListener>;
  dialogue: Set<DialogueListener>;
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
    const connection = liveConnection(worldId, browser, {
      ready: () => {
        for (const l of listeners) l(null);
      },
      tick: (tickSeq) => {
        for (const l of listeners) l(tickSeq);
      },
      dialogue: (factNo) => {
        for (const l of dialogue) l(factNo);
      },
    });
    feed = { connection, listeners, dialogue };
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
  const unused = () => feed.listeners.size === 0 && feed.dialogue.size === 0 && feeds.get(worldId) === feed;
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
