// Load a tab's data for a world, then keep it fresh: on every live nudge (#31) and, optionally, on a
// poll. Shared by the Meddle, Stable and Captains tabs. Answers pass through a `loadGate`, so a load for
// the world before a switch, or a poll that comes back after a newer one, is never shown.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLive } from './live.ts';
import { loadGate } from './load-gate.ts';

/** Null while the first load runs. */
export type Loadable<T> = T | { error: string } | null;

export const isLoaded = <T>(s: Loadable<T>): s is T => s !== null && !(typeof s === 'object' && 'error' in (s as object));

export interface WorldLoad<T> {
  state: Loadable<T>;
  /** Loads again now. */
  reload: () => void;
  /** Changes what's shown until the next load answers (an optimistic update). */
  patch: (change: (v: T) => T) => void;
}

/** `load` throws to show an error. */
export function useWorldLoad<T>(worldId: string, load: (worldId: string) => Promise<T>, opts: { pollMs?: number } = {}): WorldLoad<T> {
  const [state, setState] = useState<Loadable<T>>(null);
  const gate = useRef(loadGate());
  const latest = useRef(load);
  latest.current = load;

  const run = useCallback(() => {
    const ticket = gate.current.begin();
    latest.current(worldId).then(
      (v) => gate.current.accept(ticket) && setState(v),
      (e: unknown) => gate.current.accept(ticket) && setState({ error: e instanceof Error ? e.message : String(e) }),
    );
  }, [worldId]);

  useEffect(() => {
    const g = gate.current;
    g.reset();
    setState(null);
    run();
    const timer = opts.pollMs ? window.setInterval(run, opts.pollMs) : undefined;
    return () => {
      g.reset();
      window.clearInterval(timer);
    };
  }, [run, opts.pollMs]);

  // Every live nudge (a productive tick, or the channel reconnecting) refetches.
  useLive(worldId, () => run());

  const patch = useCallback((change: (v: T) => T) => setState((s) => (isLoaded(s) ? change(s) : s)), []);
  return { state, reload: run, patch };
}
