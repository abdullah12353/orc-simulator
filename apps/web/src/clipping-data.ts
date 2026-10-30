// Clippings (#41): cut a story from one of my editions (create-clipping builds and freezes the snapshot
// server-side), and read the world's Clippings shelf (`hall_clippings`, newest first, members only).
import type { ClippingSnapshot } from '@orc/sim';
import { supabase } from './supabase.ts';

export type { ClippingSnapshot };

export interface Clipping {
  id: string;
  factNo: number;
  /** When it was clipped. */
  at: string;
  caption: string;
  clippedBy: string;
  snapshot: ClippingSnapshot;
}

/** Clips a story printed in one of my editions. Throws with the server's reason on refusal. */
export async function clipStory(worldId: string, editionId: string, storyNo: number): Promise<Clipping> {
  const { data, error } = await supabase.functions.invoke<{ id: string; snapshot: ClippingSnapshot }>('create-clipping', {
    body: { worldId, editionId, storyNo },
  });
  if (error || !data) throw new Error(error?.message ?? 'The scissors slipped.');
  return { id: data.id, factNo: storyNo, at: new Date().toISOString(), caption: data.snapshot.headline, clippedBy: '', snapshot: data.snapshot };
}

type Row = { clipping_id: string; fact_no: number; at: string; caption: string; clipped_by: string; snapshot: ClippingSnapshot };
const fromRow = (r: Row): Clipping => ({
  id: r.clipping_id,
  factNo: Number(r.fact_no),
  at: r.at,
  caption: r.caption,
  clippedBy: r.clipped_by,
  snapshot: r.snapshot,
});
const COLUMNS = 'clipping_id, fact_no, at, caption, clipped_by, snapshot';

/** The Clippings shelf: newest first. */
export async function loadClippings(worldId: string, limit = 50): Promise<Clipping[]> {
  const { data, error } = await supabase
    .from('hall_clippings')
    .select(COLUMNS)
    .eq('world_id', worldId)
    .order('at', { ascending: false })
    .order('clipping_id', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(fromRow);
}

export async function loadClipping(id: string): Promise<Clipping | null> {
  const { data, error } = await supabase.from('hall_clippings').select(COLUMNS).eq('clipping_id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data as Row) : null;
}
