// Invite links (#25): `/join/<token>`. The token is remembered across the magic-link sign-in so a
// friend who isn't signed in yet still lands on the accept screen afterwards.
const KEY = 'orc.pendingInvite';
const JOIN_PATH = /^\/join\/([0-9a-f]{32})\/?$/i;

/** The invite this visit is about: from the URL (and remembered), or one remembered earlier. */
export function pendingInvite(): string | null {
  const m = JOIN_PATH.exec(window.location.pathname);
  if (m) {
    const token = m[1]!.toLowerCase();
    localStorage.setItem(KEY, token);
    return token;
  }
  return localStorage.getItem(KEY);
}

export function clearPendingInvite(): void {
  localStorage.removeItem(KEY);
  if (JOIN_PATH.test(window.location.pathname)) window.history.replaceState(null, '', '/');
}

export const inviteLink = (token: string) => `${window.location.origin}/join/${token}`;

/** What `invite_info(token)` says joining would do for the signed-in user. */
export type InviteStatus = 'ok' | 'not_found' | 'revoked' | 'expired' | 'member' | 'full';

const STATUS_REASON: Record<Exclude<InviteStatus, 'ok'>, string> = {
  not_found: 'invite_not_found',
  revoked: 'invite_revoked',
  expired: 'invite_expired',
  member: 'already_joined',
  full: 'world_full',
};

// The reasons the invite RPCs fail with (raised as the Postgres error message).
const REASON_TEXT: Record<string, string> = {
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

export function statusText(status: Exclude<InviteStatus, 'ok'>): string {
  return REASON_TEXT[STATUS_REASON[status]]!;
}

export function reasonText(error: { message?: string } | null | undefined): string {
  const reason = error?.message ?? '';
  return REASON_TEXT[reason] ?? (reason || 'Something went wrong. Try again.');
}

export const MAX_PLAYERS = 8;
