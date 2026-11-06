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
