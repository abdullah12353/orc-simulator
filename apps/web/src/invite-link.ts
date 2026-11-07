// Invite links (#25): `/join/<token>`. The token is remembered across the magic-link sign-in so a
// friend who isn't signed in yet still lands on the accept screen afterwards.
import { REASON_TEXT } from './reasons.ts';

export { reasonText } from './reasons.ts';

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

export function statusText(status: Exclude<InviteStatus, 'ok'>): string {
  return REASON_TEXT[STATUS_REASON[status]]!;
}

export const MAX_PLAYERS = 8;
