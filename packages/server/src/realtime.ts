// Realtime broadcasts on a world's private channel `world:<id>` (data-model §3 step 7). Only world
// members can subscribe (RLS on realtime.messages, migration 20261030003100). Clients treat a broadcast
// as "refetch": it carries a pointer, never data.
import { jsonb, type Sql, type Tx } from './db.ts';

/** The private channel a world's live events go out on. */
export const worldTopic = (worldId: string) => `world:${worldId}`;

/** What goes out on `world:<id>`: `tick` after a productive watched tick (#37 adds `dialogue`). */
export type WorldBroadcast = { event: 'tick'; payload: { tick_seq: number } };

/**
 * Sends one broadcast through `realtime.send`, which writes it to realtime.messages for Realtime to
 * deliver. Called inside a transaction, it goes out only if that transaction commits, so a broadcast
 * never points at a tick that rolled back. `realtime.send` never throws (it logs a warning), so a
 * Realtime hiccup can't fail the tick.
 */
export async function broadcast(sql: Sql | Tx, worldId: string, message: WorldBroadcast): Promise<void> {
  await sql`select realtime.send(${jsonb(sql, message.payload)}, ${message.event}, ${worldTopic(worldId)}, true)`;
}
