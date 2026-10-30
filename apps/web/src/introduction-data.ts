// Everything an Introduction card needs (#33), read under RLS: the Return / step-in head with its
// `intro`, his face once the story's own Humiliation has landed (so a Return comes in wearing it, and
// muffled if it's a mouth bandage), and the script from @orc/sim. Used live and as the Herald lead.
import { content, type ComposedPortrait } from '@orc/content';
import { introductionScript, type Fact, type IntroductionScript } from '@orc/sim';
import { INTRODUCTION_KINDS } from './live-queue.ts';
import { faceAt, loadFaces } from './portrait-data.ts';
import { supabase } from './supabase.ts';

export interface IntroductionCardData {
  no: number;
  script: IntroductionScript;
  face: ComposedPortrait;
}

type IntroFact = Extract<Fact, { intro: unknown }>;

/** Which of these story heads play an Introduction. */
export async function introductionHeads(worldId: string, storyNos: number[]): Promise<Set<number>> {
  if (storyNos.length === 0) return new Set();
  const { data } = await supabase
    .from('facts')
    .select('no')
    .eq('world_id', worldId)
    .in('kind', [...INTRODUCTION_KINDS])
    .in('no', storyNos);
  return new Set((data ?? []).map((r: { no: number }) => Number(r.no)));
}

export async function loadIntroduction(worldId: string, headNo: number): Promise<IntroductionCardData | null> {
  const { data } = await supabase.from('facts').select('no, payload').eq('world_id', worldId).eq('story_no', headNo);
  const story = (data ?? []) as { no: number; payload: Fact }[];
  const head = story.map((r) => r.payload).find((f): f is IntroFact => f.no === headNo && 'intro' in f);
  if (!head) return null;
  const id = head.intro.captainId;
  const lastNo = Math.max(...story.map((r) => Number(r.no)));
  const history = await loadFaces(worldId, [id]);
  const face = faceAt(id, history.get(id), lastNo);
  return { no: headNo, face, script: introductionScript(content, head.intro, { muffled: face.muffled }) };
}
