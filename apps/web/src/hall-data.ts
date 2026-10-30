// The Hall of Shame's reads (#40, data-model §4.2, §4.3, §4.5), all under RLS: the shelves (`hall_legends`,
// `hall_moments`; Clippings are in clipping-data.ts), a Captain's story (`captain_story`), one Player's rap sheet
// (`rap_sheet(player)`, one Player per request) and the timeline (`hall_timeline`). Everything comes back
// newest first and is never ranked (D55). "Trace it back" is `trace_back(world, fact)`, oldest first.
// Replays reuse the Clash card's own loader, which reads `clash_dialogue` and never calls a model.
import { content } from '@orc/content';
import { captainName } from './captain-names.ts';
import { nextRange } from './paging.ts';
import { supabase } from './supabase.ts';

/** One entry on a shelf, the timeline or a rap sheet: a story head, captioned. */
export interface HallEntry {
  /** The shelf it came from. */
  shelf: 'legend' | 'moment' | 'clipping' | 'rap';
  factNo: number;
  at: string;
  kind: string;
  caption: string;
  /** The Captain who went Legendary (Legends only). */
  captainId: string | null;
  /** The Clipping (Clippings only, #41). */
  clippingId: string | null;
}

/** One step of a Captain's story: a death, Return, Humiliation (Epithets included), Trophy or Legendary. */
export interface StoryEntry {
  factNo: number;
  storyNo: number;
  at: string;
  kind: string;
  text: string;
  /** The line of the story it happened in (silent Facts have none of their own). */
  storyLine: string;
}

/** One step of "trace it back", oldest first. */
export interface TraceStep {
  factNo: number;
  hops: number;
  at: string;
  kind: string;
  text: string;
}

const nameOf = (id: unknown) => captainName(String(id));

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v);
const str = (v: unknown) => (v == null ? '' : String(v));

function entry(shelf: HallEntry['shelf'], r: Row): HallEntry {
  return {
    shelf,
    factNo: num(r.fact_no),
    at: str(r.at),
    kind: str(r.kind),
    caption: str(r.caption),
    captainId: r.captain_id == null ? null : str(r.captain_id),
    clippingId: r.clipping_id == null ? null : str(r.clipping_id),
  };
}

async function rows(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Row[];
}

const SHELF_COLUMNS = 'fact_no, at, kind, caption';

export async function loadLegends(worldId: string): Promise<HallEntry[]> {
  const q = supabase
    .from('hall_legends')
    .select(`captain_id, ${SHELF_COLUMNS}`)
    .eq('world_id', worldId)
    .order('at', { ascending: false })
    .order('fact_no', { ascending: false });
  return (await rows(q)).map((r) => entry('legend', r));
}

/** How many rows a page of the Hall's long lists holds (D55: kept forever, so they page). */
export const HALL_PAGE = 50;

/** A page of the Infamous moments shelf, `shown` rows in. */
export async function loadMoments(worldId: string, shown = 0, size = HALL_PAGE): Promise<HallEntry[]> {
  const { from, to } = nextRange(shown, size);
  const q = supabase
    .from('hall_moments')
    .select(SHELF_COLUMNS)
    .eq('world_id', worldId)
    .order('at', { ascending: false })
    .order('fact_no', { ascending: false })
    .range(from, to);
  return (await rows(q)).map((r) => entry('moment', r));
}

/** A page of the timeline, `shown` rows in. */
export async function loadTimeline(worldId: string, shown = 0, size = HALL_PAGE): Promise<HallEntry[]> {
  const { from, to } = nextRange(shown, size);
  const q = supabase
    .from('hall_timeline')
    .select(`shelf, captain_id, clipping_id, ${SHELF_COLUMNS}`)
    .eq('world_id', worldId)
    .order('at', { ascending: false })
    .order('fact_no', { ascending: false })
    .order('shelf')
    .order('captain_id')
    .order('clipping_id')
    .range(from, to);
  return (await rows(q)).map((r) => entry(str(r.shelf) as HallEntry['shelf'], r));
}

/** One Player's rap sheet: their 10 heaviest Blame entries, newest first. Never more than one Player. */
export async function loadRapSheet(playerId: string): Promise<HallEntry[]> {
  return (await rows(supabase.rpc('rap_sheet', { p_player: playerId }))).map((r) => entry('rap', r));
}

export async function loadCaptainStory(worldId: string, captainId: string): Promise<StoryEntry[]> {
  const q = supabase
    .from('captain_story')
    .select('fact_no, story_no, at, kind, line, payload, story_line')
    .eq('world_id', worldId)
    .eq('captain_id', captainId)
    .order('at', { ascending: false })
    .order('fact_no', { ascending: false });
  return (await rows(q)).map((r) => ({
    factNo: num(r.fact_no),
    storyNo: num(r.story_no),
    at: str(r.at),
    kind: str(r.kind),
    text: storyText(captainId, str(r.kind), str(r.line), (r.payload ?? {}) as Row),
    storyLine: str(r.story_line),
  }));
}

export async function traceBack(worldId: string, factNo: number): Promise<TraceStep[]> {
  const steps = await rows(supabase.rpc('trace_back', { p_world: worldId, p_fact: factNo }));
  return steps.map((r) => ({
    factNo: num(r.fact_no),
    hops: num(r.hops),
    at: str(r.at),
    kind: str(r.kind),
    text: stepText(str(r.kind), str(r.line), str(r.story_line), (r.payload ?? {}) as Row),
  }));
}

/** What a Captain's story says about one of his Facts. */
export function storyText(captainId: string, kind: string, line: string, p: Row): string {
  const banks = content.banks;
  switch (kind) {
    case 'humiliation': {
      const def = banks.humiliations[str(p.key)];
      if (def?.cat === 'epithet' && def.epithet) return `Earned the Epithet "${banks.epithets[def.epithet]?.text ?? def.epithet}".`;
      return `Gained a Humiliation: ${def?.label ?? str(p.key)}.`;
    }
    case 'trophy': {
      const what = banks.trophies[str(p.key)]?.text ?? str(p.key);
      return p.to === captainId ? `Took ${nameOf(p.from)}'s ${what}.` : `Lost his ${what} to ${nameOf(p.to)}.`;
    }
    case 'death':
      return line || `${nameOf(captainId)} died.`;
    case 'legendary':
      return line || `${nameOf(captainId)} became Legendary.`;
    default:
      return line;
  }
}

/** A trace step's words: its own line, or for a silent step, what happened in plain terms. */
export function stepText(kind: string, line: string, storyLine: string, p: Row): string {
  if (line) return line;
  switch (kind) {
    case 'grudge':
      return `${nameOf(p.holder)} started holding a Grudge against ${nameOf(p.toward)}.`;
    case 'death':
      return `${nameOf(p.captainId)} died.`;
    case 'humiliation':
      return storyText(str(p.captainId), kind, line, p);
    case 'trophy':
      return `${nameOf(p.to)} took a Trophy off ${nameOf(p.from)}.`;
    case 'warlord_fell':
      return `${nameOf(p.captainId)} fell from the throne.`;
    case 'power':
      return `${nameOf(p.captainId)}'s Power went from ${str(p.from)} to ${str(p.to)}.`;
    default:
      return storyLine || kind;
  }
}

/** The world's Players, for the rap sheet picker, and which one is me (the Clash card highlights me). */
export async function loadPlayers(worldId: string): Promise<{ players: { id: string; name: string }[]; me: string | null }> {
  const [{ data: players }, { data: auth }] = await Promise.all([
    supabase.from('players').select('id, display_name, user_id').eq('world_id', worldId).is('removed_at', null).order('joined_at'),
    supabase.auth.getUser(),
  ]);
  const list = (players ?? []) as { id: string; display_name: string; user_id: string }[];
  return {
    players: list.map((p) => ({ id: p.id, name: p.display_name })),
    me: list.find((p) => p.user_id === auth.user?.id)?.id ?? null,
  };
}
