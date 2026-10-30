// Faces as of a moment (#33): each Captain's Humiliation history (ended rows included), whether he's
// Legendary and the alias he goes by, read under RLS, then composed by @orc/content's `composePortrait`.
// A Clash shows the faces as of its head; an Introduction as of its story's last Fact, so a Return's new
// Humiliation is on.
import { composePortrait, content, marksAsOf, type ComposedPortrait, type HumiliationRow } from '@orc/content';
import { aliasAsOf, captainName, goesBy } from './captain-names.ts';
import { supabase } from './supabase.ts';

export interface FaceHistory {
  /** Oldest first (by row number). */
  rows: HumiliationRow[];
  /** The Legendary deed, if he has one. */
  legendaryFact: number | null;
  /** The alias he goes by now, if he's in disguise (US78). */
  aliasIdx: 0 | 1 | null;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** The face history of these Captains. Missing Captains get an empty history. */
export async function loadFaces(worldId: string, captainIds: string[]): Promise<Map<string, FaceHistory>> {
  const ids = [...new Set(captainIds)];
  const faces = new Map<string, FaceHistory>(ids.map((id) => [id, { rows: [], legendaryFact: null, aliasIdx: null }]));
  if (ids.length === 0) return faces;
  const [humiliations, captains] = await Promise.all([
    supabase.from('humiliations').select('captain_id, kind, no, gained_fact, ended_fact').eq('world_id', worldId).in('captain_id', ids).order('no'),
    supabase.from('captains').select('id, legendary_fact, alias_idx').eq('world_id', worldId).in('id', ids),
  ]);
  for (const c of (captains.data ?? []) as { id: string; legendary_fact: number | null; alias_idx: 0 | 1 | null }[]) {
    const face = faces.get(c.id)!;
    face.legendaryFact = num(c.legendary_fact);
    face.aliasIdx = c.alias_idx;
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

/** The name he went by at Fact `factNo`: his alias if he was disguised then and still is (US78), else his name. */
export function nameAt(captainId: string, history: FaceHistory | undefined, factNo: number): string {
  if (!history) return captainName(captainId);
  return goesBy(captainId, { aliasIdx: aliasAsOf(history.aliasIdx, history.rows, factNo) });
}
