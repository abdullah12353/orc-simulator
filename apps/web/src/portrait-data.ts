// Faces as of a moment (#33): each Captain's Humiliation history (ended rows included) and whether he's
// Legendary, read under RLS, then composed by @orc/content's `composePortrait`. A Clash shows the faces
// as of its head; an Introduction as of its story's last Fact, so a Return's new Humiliation is on.
import { composePortrait, content, marksAsOf, type ComposedPortrait, type HumiliationRow } from '@orc/content';
import { supabase } from './supabase.ts';

export interface FaceHistory {
  rows: HumiliationRow[];
  /** The Legendary deed, if he has one. */
  legendaryFact: number | null;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** The face history of these Captains. Missing Captains get an empty history. */
export async function loadFaces(worldId: string, captainIds: string[]): Promise<Map<string, FaceHistory>> {
  const ids = [...new Set(captainIds)];
  const faces = new Map<string, FaceHistory>(ids.map((id) => [id, { rows: [], legendaryFact: null }]));
  if (ids.length === 0) return faces;
  const [humiliations, captains] = await Promise.all([
    supabase.from('humiliations').select('captain_id, kind, no, gained_fact, ended_fact').eq('world_id', worldId).in('captain_id', ids),
    supabase.from('captains').select('id, legendary_fact').eq('world_id', worldId).in('id', ids),
  ]);
  for (const c of (captains.data ?? []) as { id: string; legendary_fact: number | null }[]) {
    faces.get(c.id)!.legendaryFact = num(c.legendary_fact);
  }
  for (const h of (humiliations.data ?? []) as { captain_id: string; kind: string; no: number; gained_fact: number; ended_fact: number | null }[]) {
    faces.get(h.captain_id)?.rows.push({ kind: h.kind, no: Number(h.no), gainedFact: Number(h.gained_fact), endedFact: num(h.ended_fact) });
  }
  return faces;
}

/** His face as of Fact `factNo` (default: now). */
export function faceAt(captainId: string, history: FaceHistory | undefined, factNo = Number.MAX_SAFE_INTEGER): ComposedPortrait {
  const legendary = history?.legendaryFact !== null && history?.legendaryFact !== undefined && history.legendaryFact <= factNo;
  return composePortrait(content, { captainId, marks: marksAsOf(history?.rows ?? [], factNo), legendary });
}
