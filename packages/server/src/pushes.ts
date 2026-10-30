// Pushes (data-model §3 step 6, D54): the commit layer, not the sim, picks who hears about what. A Player
// hears about deaths, Returns, Warlord changes and Legendary deeds touching their Stable (Captains they
// hold a Stake on, held Stakes on dead Captains included), and about every story head with comedy weight
// >= 15 that their Meddles are to blame for (anywhere in its Blame, within the hop cap). At most one push per Player per story, 3 per London day, none in quiet hours; the dropped
// ones are logged. Pushes are never about gold.
import { content as shippedContent, type Content } from '@orc/content';
import { BLAME, londonDate, type Fact } from '@orc/sim';
import { jsonb, type Sql, type Tx } from './db.ts';
import { sendPush, type VapidKeys } from './webpush.ts';

export const PUSH = {
  perDay: 3,
  /** A story head pushes to the Players whose Meddles are in its Blame at this comedy weight or more. */
  meddleWeight: 15,
  /** Quiet hours, Europe/London: from 23:00 up to 08:00. */
  quietFrom: 23,
  quietUntil: 8,
  /** A push still queued after this long is failed as `stale` rather than sent late. */
  staleMs: 60 * 60_000,
  /** How long a push service may hold one for an offline device. */
  ttlSeconds: 4 * 3600,
  maxPerDrain: 200,
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
  meddle: () => 'Your meddling did this',
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

/** A story head heavy enough that the Players to blame for it hear about it. */
const isMeddleStory = (f: Fact) => f.no === f.storyNo && (f.comedyWeight ?? 0) >= PUSH.meddleWeight && f.blame.length > 0;

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
  const meddleHeads = facts.some(isMeddleStory);
  if (stableIds.size === 0 && !meddleHeads) return;

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
    if (isMeddleStory(f)) {
      // Every Player whose Meddle is to blame, at any hop: the head it landed as, or a story it set off.
      for (const b of f.blame) if (b.hops <= BLAME.hopCap) add({ playerId: b.playerId, storyNo: f.no, reason: 'meddle', captainId: null });
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

// ---- sending (data-model §3 step 7): after the tick commits, in the background ----

export interface PushDeps {
  sql: Sql;
  now: () => Date;
  fetch: typeof fetch;
  /** Null when the VAPID secrets aren't set: nothing is sent and pushes stay queued (then go stale). */
  vapid: VapidKeys | null;
}

export interface PushReport {
  sent: number;
  failed: number;
}

/** What the service worker gets: tapping it opens `url` (the PWA opens that world on that story). */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export const storyUrl = (worldId: string, storyNo: number) => `/?world=${worldId}&story=${storyNo}`;

/**
 * Sends the queued pushes of these worlds, oldest first, to every device of their Player. A push is
 * `sent` if any device's push service took it; devices the service says are gone (404/410) are
 * forgotten. Pushes queued longer than `PUSH.staleMs` fail as `stale` instead of arriving late. Never
 * throws for a push.
 */
export async function drainPushes(deps: PushDeps, opts: { worldIds: string[] }): Promise<PushReport> {
  const report: PushReport = { sent: 0, failed: 0 };
  if (!deps.vapid || opts.worldIds.length === 0) return report;
  const vapid = deps.vapid;
  const now = deps.now();
  await deps.sql`
    update push_jobs set status = 'failed', detail = 'stale'
    where status = 'queued' and claimed_at is null and world_id = any(${opts.worldIds}::uuid[])
      and created_at < ${new Date(now.getTime() - PUSH.staleMs).toISOString()}`;
  // Claimed in one go, so an overlapping drain can't send them twice.
  const jobs = await deps.sql<{ id: number; world_id: string; player_id: string; fact_no: number; title: string; text: string }[]>`
    update push_jobs set claimed_at = ${now.toISOString()}
    where id in (
      select id from push_jobs
      where status = 'queued' and claimed_at is null and world_id = any(${opts.worldIds}::uuid[])
      order by id limit ${PUSH.maxPerDrain}
      for update skip locked)
    returning id::float8 as id, world_id, player_id, fact_no::float8 as fact_no, title, text`;
  jobs.sort((a, b) => a.id - b.id);

  for (const job of jobs) {
    let status: 'sent' | 'failed';
    let detail: string | null;
    try {
      ({ status, detail } = await sendJob(deps.sql, deps.fetch, vapid, now, job));
    } catch (e) {
      status = 'failed';
      detail = `error: ${(e as Error)?.message ?? e}`.slice(0, 240);
    }
    await deps.sql`
      update push_jobs set status = ${status}::push_status, detail = ${detail},
                           sent_at = ${status === 'sent' ? deps.now().toISOString() : null}
      where id = ${job.id}`;
    report[status] += 1;
  }
  return report;
}

async function sendJob(
  sql: Sql,
  fetchFn: typeof fetch,
  vapid: VapidKeys,
  now: Date,
  job: { id: number; world_id: string; player_id: string; fact_no: number; title: string; text: string },
): Promise<{ status: 'sent' | 'failed'; detail: string | null }> {
  const devices = await sql<{ id: string; endpoint: string; p256dh: string; auth: string }[]>`
    select id, endpoint, p256dh, auth from push_subscriptions where player_id = ${job.player_id} order by created_at, id`;
  if (devices.length === 0) return { status: 'failed', detail: 'no device' };
  const payload: PushPayload = {
    title: job.title,
    body: job.text,
    url: storyUrl(job.world_id, job.fact_no),
    tag: `story-${job.world_id}-${job.fact_no}`,
  };
  const statuses: string[] = [];
  let took = false;
  for (const d of devices) {
    let code: number | string;
    try {
      code = await sendPush(d.endpoint, d, JSON.stringify(payload), {
        fetch: fetchFn,
        vapid,
        nowMs: now.getTime(),
        ttl: PUSH.ttlSeconds,
        topic: `s${job.fact_no}`,
      });
    } catch (e) {
      code = `error ${(e as Error)?.message ?? e}`;
    }
    if (typeof code === 'number' && code >= 200 && code < 300) took = true;
    else if (code === 404 || code === 410) await sql`delete from push_subscriptions where id = ${d.id}`;
    statuses.push(String(code));
  }
  return { status: took ? 'sent' : 'failed', detail: took ? null : statuses.join(', ').slice(0, 240) };
}
