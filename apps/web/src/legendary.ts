// Legendary deeds (#34, D45, D52): the story heads that took a Captain over 150 lifetime Infamy. Each has
// a `legendary` consequence in its story, so they are found by story number, read under RLS.
import { supabase } from './supabase.ts';

/** Which of these story heads are Legendary deeds. */
export async function legendaryDeeds(worldId: string, storyNos: number[]): Promise<Set<number>> {
  if (storyNos.length === 0) return new Set();
  const { data } = await supabase
    .from('facts')
    .select('story_no')
    .eq('world_id', worldId)
    .eq('kind', 'legendary')
    .in('story_no', storyNos);
  return new Set((data ?? []).map((r: { story_no: number }) => Number(r.story_no)));
}
