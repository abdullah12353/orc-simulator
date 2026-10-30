// create-clipping (#41, D54): cuts a story from one of the caller's own Herald editions into a Clipping.
// The card is built once, here, by `buildClipping` (@orc/sim): the headline and Blame line as printed in
// that edition, the pull quote (for a Clash, the loser's last line from `clash_dialogue`), any Trophy,
// and both portraits composed with the overlays they have right now. It's stored as a snapshot and never
// recomposed, so a later Humiliation doesn't change an old card. An Edge Function rather than plpgsql
// because the compositor is TS (like create-world).
import { content as shippedContent, type Content } from '@orc/content';
import { buildClipping, type ClashLine, type ClippingFace, type ClippingSnapshot, type Fact } from '@orc/sim';
import { jsonb, type Sql } from './db.ts';

export interface ClippingDeps {
  sql: Sql;
  now: () => Date;
  content?: Content;
}

export interface ClippingInput {
  userId: string;
  worldId: string;
  editionId: string;
  storyNo: number;
}

/** A refusal with a machine-readable reason as its message: `not_a_player`, `not_in_edition`. */
export class ClippingError extends Error {}

export async function createClipping(deps: ClippingDeps, input: ClippingInput): Promise<{ id: string; snapshot: ClippingSnapshot }> {
  const content = deps.content ?? shippedContent;
  const { worldId, storyNo } = input;
  return deps.sql.begin(async (tx) => {
    const [player] = await tx<{ id: string }[]>`
      select id from players where world_id = ${worldId} and user_id = ${input.userId} and removed_at is null`;
    if (!player) throw new ClippingError('not_a_player');

    const [printed] = await tx<
      { headline: string; blame_line: string | null; no: number; masthead: { orcDate?: string }; accusation_fact: number | null }[]
    >`
      select es.headline, es.blame_line, e.no, e.masthead, e.accusation_fact::float8 as accusation_fact
      from editions e join edition_stories es on es.edition_id = e.id
      where e.id = ${input.editionId} and e.player_id = ${player.id} and e.world_id = ${worldId} and es.story_no = ${storyNo}`;
    if (!printed) throw new ClippingError('not_in_edition');

    const facts = await tx<{ payload: Fact }[]>`
      select payload from facts
      where world_id = ${worldId} and (story_no = ${storyNo} or no = ${printed.accusation_fact})
      order by no`;
    const story = facts.map((f) => f.payload).filter((f) => f.storyNo === storyNo);
    const head = story.find((f) => f.no === storyNo);
    if (!head) throw new ClippingError('not_in_edition');
    const accusation = facts.map((f) => f.payload).find((f) => f.no === printed.accusation_fact && f.storyNo === storyNo) ?? null;

    const [dialogue] =
      head.kind === 'clash'
        ? await tx<{ lines: ClashLine[] }[]>`select lines from clash_dialogue where world_id = ${worldId} and fact_no = ${storyNo}`
        : [];

    const ids = head.kind === 'clash' ? [head.a, head.b] : [...new Set(head.cast)];
    const faces: Record<string, ClippingFace> = {};
    const [marks, legends] = await Promise.all([
      tx<{ captain_id: string; kind: string; no: number }[]>`
        select captain_id, kind, no::float8 as no from humiliations
        where world_id = ${worldId} and captain_id = any(${ids}::text[]) and ended_at is null
        order by no`,
      tx<{ id: string }[]>`
        select id from captains where world_id = ${worldId} and id = any(${ids}::text[]) and legendary_fact is not null`,
    ]);
    for (const id of ids) faces[id] = { marks: [], legendary: legends.some((c) => c.id === id) };
    for (const m of marks) faces[m.captain_id]!.marks.push({ key: m.kind, no: m.no });

    const snapshot = buildClipping(content, {
      head,
      story,
      dialogue: dialogue?.lines ?? null,
      accusation,
      headline: printed.headline,
      blameLine: printed.blame_line,
      faces,
      edition: { id: input.editionId, no: printed.no, orcDate: printed.masthead.orcDate ?? '' },
    });
    const [row] = await tx<{ id: string }[]>`
      insert into clippings (world_id, player_id, story_no, edition_id, snapshot, created_at)
      values (${worldId}, ${player.id}, ${storyNo}, ${input.editionId}, ${jsonb(tx, snapshot)}, ${deps.now().toISOString()})
      returning id`;
    return { id: row!.id, snapshot };
  });
}
