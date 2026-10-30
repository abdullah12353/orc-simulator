// Pushes (data-model §3 step 6, D54): the commit layer, not the sim, picks who hears about what. A Player
// hears about deaths, Returns, Warlord changes and Legendary deeds touching their Stable (Captains they
// hold a Stake on, held Stakes on dead Captains included), and about their own Meddles' heads with comedy
// weight >= 15. At most one push per Player per story, 3 per London day, none in quiet hours; the dropped
// ones are logged. Pushes are never about gold.
import { content as shippedContent, type Content } from '@orc/content';
import { londonDate, type Fact } from '@orc/sim';
import { jsonb, type Tx } from './db.ts';

export const PUSH = {
  perDay: 3,
  /** A Meddle's head pushes to its Player at this comedy weight or more. */
  meddleWeight: 15,
  /** Quiet hours, Europe/London: from 23:00 up to 08:00. */
  quietFrom: 23,
  quietUntil: 8,
} as const;

type Reason = 'death' | 'return' | 'warlord_fell' | 'crowned' | 'legendary' | 'meddle';

/** The Captain a Stable event is about, or null if this Fact isn't one. */
function stableCaptain(fact: Fact): { reason: Reason; captainId: string } | null {
  switch (fact.kind) {
    case 'death':
    case 'warlord_fell':
    case 'legendary':
      return { reason: fact.kind, captainId: fact.captainId };
    case 'return':
    case 'crowned':
      return { reason: fact.kind, captainId: fact.intro.captainId };
    default:
      return null;
  }
}

const TITLES: Record<Reason, (name: string) => string> = {
  death: (n) => `${n} is dead`,
  return: (n) => `${n} is back`,
  warlord_fell: (n) => `${n} fell off the throne`,
  crowned: (n) => `${n} is Warlord now`,
  legendary: (n) => `${n} did something Legendary`,
  meddle: () => 'Your meddling landed',
};

/** Pushes are never about gold: a line that so much as says the word is swapped for a plain one. */
export const mentionsGold = (s: string) => /gold/i.test(s);

export function pushText(content: Content, reason: Reason, captainId: string | null, line: string): { title: string; text: string } {
  const name = content.cast.find((c) => c.id === captainId)?.name ?? 'Someone';
  const title = TITLES[reason](name);
  const text = line.trim() && !mentionsGold(line) ? line.trim() : 'Something historic happened. Tap to read the story.';
  return { title, text };
}

/** The hour (0–23) on a Europe/London clock. */
export function londonHour(iso: string): number {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hourCycle: 'h23' }).format(new Date(iso));
  return Number(h);
}

export const inQuietHours = (iso: string) => {
  const h = londonHour(iso);
  return h >= PUSH.quietFrom || h < PUSH.quietUntil;
};

interface Candidate {
  playerId: string;
  storyNo: number;
  reason: Reason;
  captainId: string | null;
}

/**
 * Writes this tick's `push_jobs` (queued or dropped) and moves each Player's daily count. Runs inside the
 * tick's transaction, after the diff (so Stakes are as this tick left them). Only Players with at least one
 * device opted in get rows.
 */
export async function queuePushes(tx: Tx, worldId: string, facts: Fact[], now: string, content: Content = shippedContent): Promise<void> {
  const stableIds = new Set<string>();
  for (const f of facts) {
    const s = stableCaptain(f);
    if (s) stableIds.add(s.captainId);
  }
  const owners = facts.some((f) => f.no === f.storyNo && (f.comedyWeight ?? 0) >= PUSH.meddleWeight);
  if (stableIds.size === 0 && !owners) return;

  // Players who can hear a push at all: in the world, with a device.
  const listening = await tx<{ id: string; pushes_today: number; push_day: string | null }[]>`
    select p.id, pp.pushes_today, pp.push_day::text
    from players p join player_private pp on pp.player_id = p.id
    where p.world_id = ${worldId} and p.removed_at is null
      and exists (select 1 from push_subscriptions s where s.player_id = p.id)
    order by p.id`;
  if (listening.length === 0) return;
  const players = new Map(listening.map((p) => [p.id, p]));

  const backers = new Map<string, string[]>();
  if (stableIds.size > 0) {
    const rows = await tx<{ player_id: string; captain_id: string }[]>`
      select player_id, captain_id from stakes
      where world_id = ${worldId} and captain_id = any(${[...stableIds]}::text[])
      order by player_id`;
    for (const r of rows) backers.set(r.captain_id, [...(backers.get(r.captain_id) ?? []), r.player_id]);
  }

  // In Fact order; the first reason a Player has to hear about a story wins.
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const add = (c: Candidate) => {
    const key = `${c.playerId}:${c.storyNo}`;
    if (!players.has(c.playerId) || seen.has(key)) return;
    seen.add(key);
    candidates.push(c);
  };
  for (const f of facts) {
    const s = stableCaptain(f);
    if (s) for (const playerId of backers.get(s.captainId) ?? []) add({ playerId, storyNo: f.storyNo, ...s });
    if (f.no === f.storyNo && (f.comedyWeight ?? 0) >= PUSH.meddleWeight) {
      // The head a Meddle landed as: its own Blame entry (hop 0) names the Player.
      for (const b of f.blame) if (b.landedFact === f.no) add({ playerId: b.playerId, storyNo: f.no, reason: 'meddle', captainId: null });
    }
  }
  if (candidates.length === 0) return;

  const heads = new Map(facts.filter((f) => f.no === f.storyNo).map((f) => [f.no, f]));
  const missing = [...new Set(candidates.map((c) => c.storyNo))].filter((no) => !heads.has(no));
  if (missing.length > 0) {
    const rows = await tx<{ no: number; line: string }[]>`
      select no::float8 as no, line from facts where world_id = ${worldId} and no = any(${missing}::bigint[])`;
    for (const r of rows) heads.set(r.no, { line: r.line } as Fact);
  }

  const today = londonDate(now);
  const quiet = inQuietHours(now);
  const counts = new Map(listening.map((p) => [p.id, p.push_day === today ? p.pushes_today : 0]));
  const jobs = candidates.map((c) => {
    const count = counts.get(c.playerId)!;
    const status = quiet ? 'dropped_quiet' : count >= PUSH.perDay ? 'dropped_cap' : 'queued';
    if (status === 'queued') counts.set(c.playerId, count + 1);
    return { playerId: c.playerId, factNo: c.storyNo, status, ...pushText(content, c.reason, c.captainId, heads.get(c.storyNo)?.line ?? '') };
  });

  await tx`
    insert into push_jobs (world_id, player_id, fact_no, title, text, status, created_at)
    select ${worldId}, (j->>'playerId')::uuid, (j->>'factNo')::bigint, j->>'title', j->>'text', (j->>'status')::push_status, ${now}
    from jsonb_array_elements(${jsonb(tx, jobs)}) as j`;
  // The count resets at the London day roll: a count from an earlier day starts again from 0.
  const touched = [...new Set(jobs.map((j) => j.playerId))].map((id) => ({ id, count: counts.get(id)! }));
  await tx`
    update player_private pp set pushes_today = (t->>'count')::smallint, push_day = ${today}::date
    from jsonb_array_elements(${jsonb(tx, touched)}) as t
    where pp.player_id = (t->>'id')::uuid`;
}
