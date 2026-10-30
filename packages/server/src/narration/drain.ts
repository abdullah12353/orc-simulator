// drainJobs (data-model §3 step 7): runs after the tick commits, in `EdgeRuntime.waitUntil`, so narration
// never blocks or fails a tick. Each queued Clash job gets ONE call on the first provider whose quota
// can take it (Workers AI, then Groq short of the Herald reserve, else none). A format failure from Gemma
// gets one more call, on Groq (D66); refusals, timeouts and quota keep the fallback script. On success
// `clash_dialogue` is upgraded once and, when the world is watched, a `dialogue` broadcast goes out.
import { content as shippedContent, type Content } from '@orc/content';
import type { ClashFact, ClashLine, Fact } from '@orc/sim';
import { jsonb, type Sql } from '../db.ts';
import { broadcast } from '../realtime.ts';
import { isWatched } from '../tick.ts';
import { clashMessages, type ClashStory } from './prompt.ts';
import { callProvider, configured, MODELS, type ProviderId, type ProviderKeys } from './providers.ts';
import { reserve, settle, usageDay, worstCase } from './quota.ts';
import { validateClash, type NarrationFailure } from './validate.ts';

export interface NarrationDeps {
  sql: Sql;
  now: () => Date;
  /** Injected so tests can fake both providers. */
  fetch: typeof fetch;
  providers: ProviderKeys;
  content?: Content;
  /** Per call. */
  timeoutMs?: number;
}

export const NARRATION = {
  timeoutMs: 20_000,
  /** A drain stops after this many jobs; the rest wait for the next tick's drain. */
  maxJobsPerDrain: 40,
  /** Per failed call: a job's excerpt holds at most two (Gemma's, then Groq's). */
  excerptChars: 240,
  /**
   * A job still queued this long after it was claimed (or, for a Herald job, queued and never claimed)
   * lost its runtime part-way (killed inside waitUntil). It is logged as a fallback, never called again:
   * well past any Edge Function's wall-clock limit, so the drain that claimed it is surely gone.
   */
  claimTimeoutMs: 10 * 60_000,
} as const;

/** Provider order (D65). */
export const ORDER: ProviderId[] = ['workers-ai', 'groq'];

interface Job {
  id: number;
  world_id: string;
  fact_no: number;
}

export interface DrainReport {
  done: number;
  fallback: number;
}

/** Drains the queued Clash jobs of these worlds, one at a time, oldest first. Never throws for a job. */
export async function drainJobs(deps: NarrationDeps, opts: { worldIds: string[] }): Promise<DrainReport> {
  const report: DrainReport = { done: 0, fallback: 0 };
  if (opts.worldIds.length === 0) return report;
  report.fallback += await expireStaleJobs(deps, opts.worldIds);
  for (let n = 0; n < NARRATION.maxJobsPerDrain; n++) {
    const job = await claim(deps, opts.worldIds);
    if (!job) break;
    let outcome: Outcome;
    try {
      outcome = await runClashJob(deps, job);
    } catch (e) {
      outcome = { status: 'fallback', provider: null, failure: null, excerpt: `error: ${(e as Error)?.message ?? e}`, neurons: null, tokens: null };
    }
    await finish(deps, job, outcome);
    report[outcome.status] += 1;
  }
  return report;
}

/**
 * Logs as fallbacks the jobs of these worlds whose runtime died part-way: claimed over
 * `NARRATION.claimTimeoutMs` ago and still queued, or a Herald job queued that long and never claimed
 * (its open-edition was killed before it ran). Their templated words stand. Returns how many.
 */
async function expireStaleJobs(deps: Pick<NarrationDeps, 'sql' | 'now'>, worldIds: string[]): Promise<number> {
  const now = deps.now();
  const cutoff = new Date(now.getTime() - NARRATION.claimTimeoutMs).toISOString();
  const expired = await deps.sql`
    update narration_jobs
    set status = 'fallback', failure = 'timeout', finished_at = ${now.toISOString()},
        excerpt = case when claimed_at is null then 'never run: its runtime ended before the call'
                       else 'claim expired: the drain that claimed it never finished' end
    where status = 'queued' and world_id = any(${worldIds}::uuid[])
      and (claimed_at < ${cutoff} or (claimed_at is null and kind = 'herald' and created_at < ${cutoff}))
    returning id`;
  return expired.length;
}

/** Takes the oldest unclaimed queued job, so an overlapping drain can't also call a model for it. */
async function claim(deps: NarrationDeps, worldIds: string[]): Promise<Job | null> {
  const [job] = await deps.sql<Job[]>`
    update narration_jobs set claimed_at = ${deps.now().toISOString()}
    where id = (
      select id from narration_jobs
      where status = 'queued' and claimed_at is null and kind = 'clash' and world_id = any(${worldIds}::uuid[])
      order by id limit 1
      for update skip locked)
    returning id::float8 as id, world_id, fact_no::float8 as fact_no`;
  return job ?? null;
}

type Attempt =
  | { ok: true; provider: ProviderId; lines: ClashLine[] }
  | { ok: false; provider: ProviderId; failure: NarrationFailure };

export interface Outcome {
  status: 'done' | 'fallback';
  provider: ProviderId | null;
  failure: NarrationFailure | null;
  excerpt: string | null;
  neurons: number | null;
  tokens: number | null;
}

async function runClashJob(deps: NarrationDeps, job: Job): Promise<Outcome> {
  const content = deps.content ?? shippedContent;
  const story = await loadStory(deps.sql, job, content);
  const messages = clashMessages(content, story);
  const promptChars = messages.reduce((n, m) => n + m.content.length, 0);
  const day = usageDay(deps.now());
  const call = { fetch: deps.fetch, keys: deps.providers, timeoutMs: deps.timeoutMs ?? NARRATION.timeoutMs };

  const spent = { neurons: 0, tokens: 0, any: false };
  const excerpts: string[] = [];
  /** One call on `provider`, if its quota takes it. Null: no quota, so no call was made. */
  const attempt = async (provider: ProviderId): Promise<Attempt | null> => {
    const estimate = worstCase(provider, promptChars);
    if (!(await reserve(deps.sql, { day, provider, kind: 'clash' }, estimate))) return null;
    const result = await callProvider(provider, call, messages);
    const used = await settle(deps.sql, { day, provider }, estimate, result.usage);
    if (used) {
      spent.any = true;
      spent.neurons += used.neurons;
      spent.tokens += used.tokens;
    }
    if (!result.ok) {
      excerpts.push(`${provider} ${result.failure}: ${result.detail}`.slice(0, NARRATION.excerptChars));
      return { ok: false, provider, failure: result.failure };
    }
    const verdict = validateClash(content, story.clash, result.content);
    if (!verdict.ok) {
      excerpts.push(`${provider} ${verdict.failure} (${verdict.why}): ${result.content}`.slice(0, NARRATION.excerptChars));
      return { ok: false, provider, failure: verdict.failure };
    }
    return { ok: true, provider, lines: verdict.lines };
  };

  let last: Attempt | null = null;
  for (const provider of ORDER.filter((p) => configured(deps.providers, p))) {
    last = await attempt(provider);
    if (last) break;
  }
  // D66: Gemma's format failure gets one go on Groq. Nothing else is retried.
  if (last && !last.ok && last.failure === 'bad_output' && last.provider === 'workers-ai' && configured(deps.providers, 'groq')) {
    last = (await attempt('groq')) ?? last;
  }

  const base = {
    excerpt: excerpts.length > 0 ? excerpts.join(' | ') : null,
    neurons: spent.any ? spent.neurons : null,
    tokens: spent.any ? spent.tokens : null,
  };
  if (!last) {
    const anyKeys = ORDER.some((p) => configured(deps.providers, p));
    return { ...base, status: 'fallback', provider: null, failure: 'quota', excerpt: anyKeys ? 'no quota left' : 'no provider configured' };
  }
  if (!last.ok) return { ...base, status: 'fallback', provider: last.provider, failure: last.failure };
  const won = last;

  // Upgraded exactly once: only a fallback script is ever replaced. Broadcast in the same transaction, so
  // a live card is only told about lines that committed.
  await deps.sql.begin(async (tx) => {
    const upgraded = await tx`
      update clash_dialogue
      set lines = ${jsonb(tx, won.lines)}, source = 'generated', provider = ${won.provider},
          model = ${MODELS[won.provider]}, updated_at = ${deps.now().toISOString()}
      where world_id = ${job.world_id} and fact_no = ${job.fact_no} and source = 'fallback'
      returning 1`;
    if (upgraded.length === 1 && (await isWatched(tx, job.world_id, deps.now().toISOString()))) {
      await broadcast(tx, job.world_id, { event: 'dialogue', payload: { fact_no: job.fact_no } });
    }
  });
  // A success after Gemma's format failure still logs that failure.
  const gemmaFailed = excerpts.length > 0;
  return { ...base, status: 'done', provider: won.provider, failure: gemmaFailed ? 'bad_output' : null };
}

/**
 * The Clash and its story's Trophy, from the log (Facts only), and each speaker's Epithet as the Clash
 * began: from his newest Epithet Humiliation gained before it (one replaces the last, and the Epithet
 * stays when it ends), else his cast card's.
 */
async function loadStory(sql: Sql, job: Job, content: Content): Promise<ClashStory> {
  const rows = await sql<{ payload: Fact }[]>`
    select payload from facts where world_id = ${job.world_id} and story_no = ${job.fact_no} order by no`;
  const facts = rows.map((r) => r.payload);
  const clash = facts.find((f): f is ClashFact => f.kind === 'clash' && f.no === job.fact_no);
  if (!clash) throw new Error(`narration: Fact ${job.fact_no} is not a Clash`);
  const trophy = facts.find((f) => f.kind === 'trophy');
  const speakers = [clash.a, clash.b, ...(clash.saviour ? [clash.saviour] : [])];
  const marks = await sql<{ captain_id: string; kind: string }[]>`
    select distinct on (captain_id) captain_id, kind from humiliations
    where world_id = ${job.world_id} and cat = 'epithet' and captain_id = any(${speakers}::text[]) and gained_fact < ${job.fact_no}
    order by captain_id, gained_fact desc`;
  const epithets = Object.fromEntries(marks.map((m) => [m.captain_id, content.banks.humiliations[m.kind]?.epithet ?? null]));
  return { clash, trophy: trophy?.kind === 'trophy' ? { key: trophy.key, from: trophy.from, to: trophy.to } : null, epithets };
}

export async function finish(deps: Pick<NarrationDeps, 'sql' | 'now'>, job: { id: number }, o: Outcome): Promise<void> {
  await deps.sql`
    update narration_jobs
    set status = ${o.status}::job_status, provider = ${o.provider}, failure = ${o.failure}, excerpt = ${o.excerpt},
        neurons = ${o.neurons}, tokens = ${o.tokens}, finished_at = ${deps.now().toISOString()}
    where id = ${job.id}`;
}
