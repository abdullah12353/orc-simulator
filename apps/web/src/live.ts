// Live watching (#31). While the app is open and visible the Player marks itself seen about once a
// minute, which makes the tick treat the world as watched (it steps every minute). After a watched tick
// that made Facts, the tick broadcasts `{tick_seq}` on the private channel `world:<id>`; the broadcast
// is only a nudge, and listeners refetch what they show.
import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase.ts';

/** How often an open, visible app marks its Player seen. Comfortably inside the tick's 5-minute window. */
const SEEN_EVERY_MS = 60_000;

/** Marks me seen in this world while the app is open and visible (on open, every minute, and on return). */
export function useSeen(worldId: string): void {
  useEffect(() => {
    const mark = () => {
      if (document.visibilityState === 'visible') void supabase.rpc('mark_seen', { world_id: worldId });
    };
    mark();
    const timer = window.setInterval(mark, SEEN_EVERY_MS);
    document.addEventListener('visibilitychange', mark);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', mark);
    };
  }, [worldId]);
}

/**
 * A live nudge: `tickSeq` is the tick that made new Facts, or null when the channel (re)connected and
 * anything may have been missed. Either way, refetch.
 */
export type LiveListener = (tickSeq: number | null) => void;

interface Feed {
  channel: RealtimeChannel;
  listeners: Set<LiveListener>;
}
const feeds = new Map<string, Feed>();

/** Listens to a world's channel. One channel per world, shared by every listener in the app. */
export function listenLive(worldId: string, listener: LiveListener): () => void {
  let feed = feeds.get(worldId);
  if (!feed) {
    const listeners = new Set<LiveListener>();
    const channel = supabase.channel(`world:${worldId}`, { config: { private: true } });
    channel.on('broadcast', { event: 'tick' }, (message) => {
      const tickSeq = Number((message.payload as { tick_seq?: unknown }).tick_seq);
      if (Number.isFinite(tickSeq)) for (const l of listeners) l(tickSeq);
    });
    void supabase.realtime.setAuth().then(() =>
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') for (const l of listeners) l(null);
      }),
    );
    feed = { channel, listeners };
    feeds.set(worldId, feed);
  }
  const current = feed;
  current.listeners.add(listener);
  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size === 0 && feeds.get(worldId) === current) {
      feeds.delete(worldId);
      void supabase.removeChannel(current.channel);
    }
  };
}

/** Calls `onNudge` on every live nudge for this world (latest callback, stable subscription). */
export function useLive(worldId: string, onNudge: LiveListener): void {
  const latest = useRef(onNudge);
  latest.current = onNudge;
  useEffect(() => listenLive(worldId, (seq) => latest.current(seq)), [worldId]);
}
