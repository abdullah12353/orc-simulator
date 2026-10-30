// The first open and the hints, against the database (#43). begin_first_open is true once per Player
// (it stamps first_open_at), and see_hint is true once per hint (it records it in hints_seen), so the
// sequence and each hint can never come back. Both answers are cached per page load: React's StrictMode
// runs effects twice, and the second call would (rightly) say "not the first time" and hide them.
import { useEffect, useState } from 'react';
import { content, KRUG } from '@orc/content';
import { introductionScript } from '@orc/sim';
import type { Hint } from './first-open.ts';
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

/** True on this Player's very first open of the world (and only for this page load). */
export function useFirstOpen(worldId: string): boolean | undefined {
  const [first, setFirst] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void askOnce(`open:${worldId}`, () => supabase.rpc('begin_first_open', { world_id: worldId })).then((f) => live && setFirst(f));
    return () => {
      live = false;
    };
  }, [worldId]);
  return first;
}

/** True if this is the first time the Player meets `hint` (show its one-liner). */
export function useHint(worldId: string, hint: Hint): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let live = true;
    void askOnce(`hint:${worldId}:${hint}`, () => supabase.rpc('see_hint', { world_id: worldId, hint })).then((s) => live && setShow(s));
    return () => {
      live = false;
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
