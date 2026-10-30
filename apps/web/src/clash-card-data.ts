// Everything a Clash card needs, read under RLS (#30): the Clash Fact, its stored dialogue (fallback or
// generated, never a model call), the Trophy that changed hands, and the Blame line. Used by the Herald's
// lead now, and by live play (#31) and Hall replays (#40).
import { blameLine, content, type ComposedPortrait } from '@orc/content';
import type { ClashFact, ClashLine, Fact } from '@orc/sim';
import { faceAt, loadFaces } from './portrait-data.ts';
import { supabase } from './supabase.ts';

export interface ClashCardData {
  clash: ClashFact;
  /** 3 lines, or 4 with a wrong saviour; the loser last. */
  lines: ClashLine[];
  source: 'fallback' | 'generated';
  trophy: { key: string; from: string; to: string } | null;
  blameLine: string | null;
  /** Each Captain's face as the Clash began (#33): his overlays then, and whether he was muffled. */
  faces: Record<string, ComposedPortrait>;
}

/** Which of these story heads are Clashes. */
export async function clashHeads(worldId: string, storyNos: number[]): Promise<Set<number>> {
  if (storyNos.length === 0) return new Set();
  const { data } = await supabase.from('facts').select('no').eq('world_id', worldId).eq('kind', 'clash').in('no', storyNos);
  return new Set((data ?? []).map((r: { no: number }) => Number(r.no)));
}

/**
 * Loads a Clash card. `knownBlameLine` is the edition's stored line when there is one; otherwise the line
 * is built here from `fact_blame`, the same way the Herald builds it.
 */
export async function loadClashCard(worldId: string, factNo: number, knownBlameLine?: string | null): Promise<ClashCardData | null> {
  const [story, dialogue] = await Promise.all([
    supabase.from('facts').select('no, payload').eq('world_id', worldId).eq('story_no', factNo),
    supabase.from('clash_dialogue').select('lines, source').eq('world_id', worldId).eq('fact_no', factNo).maybeSingle(),
  ]);
  const facts = ((story.data ?? []) as { payload: Fact }[]).map((r) => r.payload);
  const clash = facts.find((f): f is ClashFact => f.kind === 'clash' && f.no === factNo);
  if (!clash || !dialogue.data) return null;
  const trophy = facts.find((f) => f.kind === 'trophy');
  const ids = [clash.a, clash.b, ...(clash.saviour ? [clash.saviour] : [])];
  const history = await loadFaces(worldId, ids);

  return {
    faces: Object.fromEntries(ids.map((id) => [id, faceAt(id, history.get(id), clash.no)])),
    clash,
    lines: dialogue.data.lines as ClashLine[],
    source: dialogue.data.source as ClashCardData['source'],
    trophy: trophy?.kind === 'trophy' ? { key: trophy.key, from: trophy.from, to: trophy.to } : null,
    blameLine: knownBlameLine !== undefined ? knownBlameLine : await loadBlameLine(worldId, factNo),
  };
}

/** A Clash's stored dialogue alone: what a live card refetches when its generated lines land (#37). */
export async function loadClashDialogue(worldId: string, factNo: number): Promise<Pick<ClashCardData, 'lines' | 'source'> | null> {
  const { data } = await supabase.from('clash_dialogue').select('lines, source').eq('world_id', worldId).eq('fact_no', factNo).maybeSingle();
  if (!data) return null;
  return { lines: data.lines as ClashLine[], source: data.source as ClashCardData['source'] };
}

async function loadBlameLine(worldId: string, factNo: number): Promise<string | null> {
  const { data } = await supabase
    .from('fact_blame')
    .select('player_id, verb, landed_at, landed_fact, meddle_id')
    .eq('world_id', worldId)
    .eq('fact_no', factNo)
    .order('landed_at')
    .order('landed_fact')
    .order('meddle_id');
  const rows = (data ?? []) as { player_id: string; verb: 'rumour' | 'dare' }[];
  if (rows.length === 0) return null;
  const { data: players } = await supabase.from('players').select('id, display_name').eq('world_id', worldId);
  const names = new Map(((players ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  return blameLine(content, rows.map((r) => ({ name: names.get(r.player_id) ?? 'Someone', verb: r.verb })));
}
