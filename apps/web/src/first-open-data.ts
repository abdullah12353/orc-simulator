// The first open and the hints, against the database (#43). begin_first_open is true once per Player
// (it stamps first_open_at), and see_hint is true once per hint (it records it in hints_seen), so the
// sequence and each hint can never come back. Both answers are cached per page load: React's StrictMode
// runs effects twice, and the second call would (rightly) say "not the first time" and hide them.
// begin_first_open stamps before anything plays, so the device remembers how far the first open got (per
// world and Player, in localStorage) and a closed app picks up where it stopped.
import { useCallback, useEffect, useState } from 'react';
import { content, KRUG } from '@orc/content';
import { introductionScript } from '@orc/sim';
import { nextStep, progressAfter, resumeFirstOpen, type FirstOpenStep, type Hint } from './first-open.ts';
import type { IntroductionCardData } from './introduction-data.ts';
import { faceAt, loadFaces } from './portrait-data.ts';
import { supabase } from './supabase.ts';

const once = new Map<string, Promise<boolean>>();

function askOnce(key: string, call: () => PromiseLike<{ data: unknown; error: unknown }>): Promise<boolean> {
  let p = once.get(key);
  if (!p) {
    p = Promise.resolve(call()).then(({ data, error }) => !error && data === true);
    once.set(key, p);
  }
  return p;
}

const progressKey = (worldId: string, playerId: string) => `orc:first-open:${worldId}:${playerId}`;

function remembered(key: string | null): string | null {
  try {
    return key ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function remember(key: string | null, value: string | null): void {
  if (!key) return;
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // no storage (private mode): the first open just can't resume
  }
}

interface FirstOpenState {
  key: string | null;
  running: boolean;
  done: FirstOpenStep | null;
}

export interface FirstOpen {
  /** The step to play now; null = no first open (or it's over); undefined while asking. */
  step: FirstOpenStep | null | undefined;
  /** Marks the current step done (any other step is ignored). */
  finish: (step: FirstOpenStep) => void;
}

/** This Player's first open of the world: fresh from begin_first_open, or resumed from this device. */
export function useFirstOpen(worldId: string): FirstOpen {
  const [state, setState] = useState<FirstOpenState | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      askOnce(`open:${worldId}`, () => supabase.rpc('begin_first_open', { world_id: worldId })),
      supabase.rpc('my_player', { w: worldId }),
    ]).then(([fresh, me]) => {
      if (cancelled) return;
      const key = typeof me.data === 'string' ? progressKey(worldId, me.data) : null;
      const resumed = resumeFirstOpen(fresh, remembered(key));
      if (fresh) remember(key, progressAfter(null));
      setState({ key, ...resumed });
    });
    return () => {
      cancelled = true;
    };
  }, [worldId]);
  const finish = useCallback((step: FirstOpenStep) => {
    setState((s) => {
      if (!s || nextStep(s.running, s.done) !== step) return s;
      remember(s.key, progressAfter(step));
      return { ...s, done: step };
    });
  }, []);
  return { step: state && nextStep(state.running, state.done), finish };
}

/** True if this is the first time the Player meets `hint` (show its one-liner). */
export function useHint(worldId: string, hint: Hint): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void askOnce(`hint:${worldId}:${hint}`, () => supabase.rpc('see_hint', { world_id: worldId, hint })).then((s) => !cancelled && setShow(s));
    return () => {
      cancelled = true;
    };
  }, [worldId, hint]);
  return show;
}

/** Krúg's Introduction, as he is now (alias, Epithet, Humiliations, Legendary), for the first open. */
export async function loadKrugIntroduction(worldId: string): Promise<IntroductionCardData | null> {
  const { data } = await supabase.from('captains').select('alias_idx, epithet, legendary_fact').eq('world_id', worldId).eq('id', KRUG).single();
  if (!data) return null;
  const row = data as { alias_idx: 0 | 1 | null; epithet: string | null; legendary_fact: number | null };
  const history = await loadFaces(worldId, [KRUG]);
  const face = faceAt(KRUG, history.get(KRUG));
  const intro = { captainId: KRUG, aliasIdx: row.alias_idx, epithet: row.epithet, legendary: row.legendary_fact !== null };
  return { no: 0, face, crowned: false, script: introductionScript(content, intro, { muffled: face.muffled }) };
}
