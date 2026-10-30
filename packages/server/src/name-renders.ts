// Name renders (D59, #39): the operator records a prerecorded clip of one of the 6 accusers saying a
// Player's mangled name. From then on that accuser can name him in an Accusation. Operator-only: run it
// with the service connection (`npm run names:register`), never from a client.
import { content as shippedContent, type Content } from '@orc/content';
import type { Sql } from './db.ts';

export interface NameRenderInput {
  playerId: string;
  /** One of the 6 accuser Captains. */
  accuserId: string;
  /** Where the clip lives in storage (R2 path). */
  clipKey: string;
  /** The mangled name the clip says. It joins the Player's `mangled_names`. */
  says: string;
}

/** A refusal with a machine-readable reason as its message (`not_an_accuser`, `no_such_player`, `blank`). */
export class NameRenderError extends Error {}

/**
 * Registers (or replaces) the clip of `accuserId` saying a Player's mangled name, and adds that name to
 * the Player's `mangled_names` if it isn't there yet.
 */
export async function registerNameRender(
  deps: { sql: Sql; content?: Content; now?: () => Date },
  input: NameRenderInput,
): Promise<void> {
  const content = deps.content ?? shippedContent;
  if (!content.cast.some((c) => c.id === input.accuserId && c.accuser)) throw new NameRenderError('not_an_accuser');
  const clipKey = input.clipKey.trim();
  const says = input.says.trim();
  if (!clipKey || !says) throw new NameRenderError('blank');
  const at = (deps.now?.() ?? new Date()).toISOString();

  await deps.sql.begin(async (tx) => {
    const [player] = await tx<{ id: string }[]>`
      select id from players where id = ${input.playerId} and removed_at is null for update`;
    if (!player) throw new NameRenderError('no_such_player');
    await tx`
      insert into name_renders (player_id, accuser_id, clip_key, says, rendered_at)
      values (${input.playerId}, ${input.accuserId}, ${clipKey}, ${says}, ${at})
      on conflict (player_id, accuser_id) do update set
        clip_key = excluded.clip_key, says = excluded.says, rendered_at = excluded.rendered_at`;
    await tx`
      update players set mangled_names = array_append(mangled_names, ${says}::text)
      where id = ${input.playerId} and not (${says}::text = any(mangled_names))`;
  });
}
