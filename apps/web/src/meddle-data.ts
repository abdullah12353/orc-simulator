// The Meddle tab's data (#28, #35), shared by the Rumour composer and the Dare picker: my Meddles, every
// Captain with what the pickers need (Traits, Fears, Trophies, Epithet, disguise), and the Warlord.
import { captainName, pickerLabel } from './captain-names.ts';
import { supabase } from './supabase.ts';

export interface MeddleCaptain {
  id: string;
  roster: 'active' | 'reserve' | 'dead';
  traits: string[];
  epithet: string | null;
  /** In disguise: the alias he goes by (US78). */
  aliasIdx: 0 | 1 | null;
}

export interface Subject {
  from: 'trait' | 'fear' | 'trophy';
  key: string;
}

export interface MeddleData {
  meddlesLeft: number;
  /** The Player has sent a Meddle before (#43): the next one doesn't get the short first Fuse. */
  firstMeddleDone: boolean;
  captains: MeddleCaptain[];
  fears: Map<string, string[]>;
  /** The Trophies each Captain holds (bank keys), newest first. */
  trophies: Map<string, string[]>;
  pending: number;
  /** The Warlord, marked wherever Captains are picked (#34). */
  warlordId: string | null;
}

const group = (rows: { id: string; value: string }[]) => {
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.id, [...(out.get(r.id) ?? []), r.value]);
  return out;
};

export async function loadMeddle(worldId: string): Promise<MeddleData> {
  const { data: me } = await supabase.rpc('my_player', { w: worldId });
  const [priv, captains, fears, trophies, meddles, queued, world] = await Promise.all([
    supabase.from('player_private').select('meddles_available, first_meddle_done').eq('player_id', me).single(),
    supabase.from('captains').select('id, roster, traits, epithet, alias_idx').eq('world_id', worldId),
    supabase.from('captain_fears').select('captain_id, fear').eq('world_id', worldId).order('since'),
    supabase
      .from('trophies')
      .select('kind, holder_id')
      .eq('world_id', worldId)
      .order('acquired_at', { ascending: false })
      .order('no', { ascending: false }),
    supabase.from('meddles').select('id', { count: 'exact', head: true }).eq('player_id', me).neq('status', 'landed'),
    supabase.from('intents').select('id', { count: 'exact', head: true }).eq('player_id', me).eq('status', 'queued').in('kind', ['rumour', 'dare']),
    supabase.from('worlds').select('warlord_id').eq('id', worldId).single(),
  ]);
  const error = priv.error ?? captains.error ?? fears.error ?? trophies.error ?? meddles.error ?? queued.error;
  if (error) throw new Error(error.message);
  return {
    meddlesLeft: priv.data?.meddles_available ?? 0,
    firstMeddleDone: priv.data?.first_meddle_done ?? true,
    captains: (captains.data ?? [])
      .map((c) => ({ id: c.id, roster: c.roster, traits: c.traits, epithet: c.epithet, aliasIdx: c.alias_idx }))
      .sort((a, b) => captainName(a.id).localeCompare(captainName(b.id))),
    fears: group((fears.data ?? []).map((f) => ({ id: f.captain_id, value: f.fear }))),
    trophies: group((trophies.data ?? []).map((t) => ({ id: t.holder_id, value: t.kind }))),
    pending: (meddles.count ?? 0) + (queued.count ?? 0),
    warlordId: world.data?.warlord_id ?? null,
  };
}

/** A Captain as both pickers list him. */
export const meddleLabel = (data: MeddleData) => (id: string) =>
  pickerLabel(
    id,
    data.captains.find((c) => c.id === id),
    data.warlordId,
  );
