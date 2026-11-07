// Player-facing lines for the reasons the server refuses with: the RPCs' Postgres error messages, and the
// Worker's `{ error }` answers. No browser globals, so the Worker's answers are tested under node (#69).
// The reasons the invite RPCs fail with (raised as the Postgres error message).
export const REASON_TEXT: Record<string, string> = {
  invite_not_found: "That invite link doesn't exist. Check you copied all of it.",
  invite_revoked: 'That invite link has been revoked. Ask for a fresh one.',
  invite_expired: 'That invite link has expired (they last 7 days). Ask for a fresh one.',
  world_full: 'This world is full: it already has 8 Players.',
  already_joined: "You're already a Player in this world.",
  bad_display_name: 'Your name needs 1–40 characters.',
  display_name_taken: 'Another Player in this world already goes by that name.',
  not_signed_in: 'Sign in first.',
  not_a_player: 'Only Players in this world can do that.',
  bad_subscription: 'This browser handed over a push subscription the server could not use.',
  // submit_intent (#28)
  no_meddles_left: "You're out of Meddles. Three more arrive at midnight.",
  bad_rumour: 'That Rumour is missing a piece: pick a source, a target, a Claim and a subject.',
  bad_dare: 'That Dare is missing a piece: pick a Captain, a Dare, and a different victim for a Prank.',
  unsupported_kind: "That kind of Meddle isn't open yet.",
  intent_id_taken: 'Something went wrong. Try again.',
  // submit_intent, Backing (#36)
  not_enough_gold: "You haven't got that much gold. 10 more arrives at midnight.",
  bad_stake: 'A Stake is a whole number of gold, at least 1, on a Captain in this world.',
  no_stake: "You don't back that Captain.",
};

export function reasonText(error: { message?: string } | null | undefined): string {
  const reason = error?.message ?? '';
  return REASON_TEXT[reason] ?? (reason || 'Something went wrong. Try again.');
}
