// The edition's one Accusation (#39, D53): a pull quote over its story's true Blame line. open-edition
// returns it for the edition it opens; back issues read under RLS carry only `accusation_fact`, so the
// PWA joins it up here by the server's rule (herald.ts `loadAccusation`): the accused Player must still be
// in the world and have a render for that accuser. Pure, so it's tested in apps/web/test.

export interface Accusation {
  factNo: number;
  storyNo: number;
  /** The accusing Captain. */
  accuser: string;
  line: string;
  /** His clip of the Player's mangled name. */
  clipKey: string;
}

export interface AccusationFactRow {
  no: number;
  story_no: number;
  line: string;
  payload: { accused?: string; accuser?: string };
}

export interface NameRenderRow {
  player_id: string;
  accuser_id: string;
  clip_key: string;
}

/** The Accusations that may still show, by Fact number. */
export function accusationsFrom(
  facts: AccusationFactRow[],
  renders: NameRenderRow[],
  players: { id: string; removed_at: string | null }[],
): Map<number, Accusation> {
  const present = new Set(players.filter((p) => p.removed_at === null).map((p) => p.id));
  const out = new Map<number, Accusation>();
  for (const f of facts) {
    const { accused, accuser } = f.payload;
    if (!accused || !accuser || !present.has(accused)) continue;
    const render = renders.find((r) => r.player_id === accused && r.accuser_id === accuser);
    if (!render) continue;
    const no = Number(f.no);
    out.set(no, { factNo: no, storyNo: Number(f.story_no), accuser, line: f.line, clipKey: render.clip_key });
  }
  return out;
}
