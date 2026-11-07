// Live hints (data-model §3 step 7, #55): a world's live connections are told when to refetch. A hint is a
// pointer, never data. The tick and the narration drain RETURN their hints, and only once their
// transaction has committed, so a hint never points at work that rolled back (#55 item 2). Sending them
// is the world's Durable Object's job (#67, #68); nothing in the database carries them.

/**
 * `tick` after a productive watched tick, and `dialogue` when a Clash's generated lines replace its
 * fallback script (only while the world is watched).
 */
export type LiveHint =
  | { event: 'tick'; payload: { tick_seq: number } }
  | { event: 'dialogue'; payload: { fact_no: number } };

/**
 * Whether a world is watched right now. The world's Durable Object knows, from its live connections
 * (#55 item 5); without one, every world is unwatched.
 */
export type IsWatched = (worldId: string) => boolean;

/**
 * What a world's DO sends down a live socket (#55 item 6). `ready` answers an open once the world has
 * caught up (#53 item 2); `tick` and `dialogue` are the hints above. The client only ever sends pings,
 * which the runtime answers without waking the DO.
 */
export type LiveMessage =
  | { type: 'ready'; tick_seq: number }
  | { type: 'tick'; tick_seq: number }
  | { type: 'dialogue'; fact_no: number };

/** A committed hint as the message the sockets get. */
export function liveMessage(hint: LiveHint): LiveMessage {
  return hint.event === 'tick' ? { type: 'tick', tick_seq: hint.payload.tick_seq } : { type: 'dialogue', fact_no: hint.payload.fact_no };
}

/** The ping a client sends and the pong the runtime answers it with, without waking the DO. */
export const LIVE_PING = { request: 'ping', response: 'pong' } as const;

/**
 * The sockets whose Player is no longer in the world (#55 item 3): removals go straight to Postgres, so
 * the DO compares its sockets with the member list on every tick. A socket with no user is closed too.
 */
export function removedSockets<S>(sockets: readonly S[], userOf: (socket: S) => string | null, players: ReadonlySet<string>): S[] {
  return sockets.filter((s) => {
    const userId = userOf(s);
    return userId === null || !players.has(userId);
  });
}
