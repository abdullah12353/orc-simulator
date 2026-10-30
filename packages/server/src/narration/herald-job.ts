// The Herald job (data-model §3 step 10, D53): ONE model call writes the headlines, standfirsts and
// bodies of an edition's lead and headlines, through the same quota router as the Clash jobs but
// allowed to spend Groq's Herald reserve. The gutter keeps its lines and Blame lines are never sent or
// touched. A failure of any kind keeps the templated edition, and nothing is retried.
import { content as shippedContent } from '@orc/content';
import { jsonb, type Sql, type Tx } from '../db.ts';
import { finish, NARRATION, ORDER, type NarrationDeps, type Outcome } from './drain.ts';
import { heraldMessages, type HeraldStory } from './prompt.ts';
import { callProvider, configured } from './providers.ts';
import { reserve, settle, usageDay, worstCase } from './quota.ts';
import { validateHerald } from './validate.ts';

/** Queues the edition's Herald job (in the edition's transaction). The job is the outbox row and the log. */
export async function queueHeraldJob(
  tx: Sql | Tx,
  edition: { worldId: string; editionId: string; now: string },
): Promise<number> {
  const [job] = await tx<{ id: number }[]>`
    insert into narration_jobs (world_id, kind, edition_id, created_at)
    values (${edition.worldId}, 'herald', ${edition.editionId}, ${edition.now})
    returning id::float8 as id`;
  return job!.id;
}

/** Runs one Herald job to the end: claim, one call (if any quota takes it), validate, write, log. Never throws. */
export async function runHeraldJob(deps: NarrationDeps, jobId: number): Promise<Outcome['status'] | null> {
  const [job] = await deps.sql<{ id: number; edition_id: string; world_id: string }[]>`
    update narration_jobs set claimed_at = ${deps.now().toISOString()}
    where id = ${jobId} and kind = 'herald' and status = 'queued' and claimed_at is null
    returning id::float8 as id, edition_id, world_id`;
  if (!job) return null;
  let outcome: Outcome;
  try {
    outcome = await writeEdition(deps, job);
  } catch (e) {
    outcome = { status: 'fallback', provider: null, failure: null, excerpt: `error: ${(e as Error)?.message ?? e}`, neurons: null, tokens: null };
  }
  await finish(deps, job, outcome);
  return outcome.status;
}

async function writeEdition(deps: NarrationDeps, job: { edition_id: string; world_id: string }): Promise<Outcome> {
  const content = deps.content ?? shippedContent;
  const stories = await deps.sql<HeraldStory[]>`
    select s.rank, f.kind, f.line, f."cast" as cast
    from edition_stories s join facts f on f.world_id = ${job.world_id} and f.no = s.story_no
    where s.edition_id = ${job.edition_id} and s.slot <> 'gutter'
    order by s.rank`;
  const none = { neurons: null, tokens: null };
  const anyKeys = ORDER.some((p) => configured(deps.providers, p));
  if (!anyKeys) return { ...none, status: 'fallback', provider: null, failure: 'quota', excerpt: 'no provider configured' };

  const messages = heraldMessages(content, stories);
  const promptChars = messages.reduce((n, m) => n + m.content.length, 0);
  const day = usageDay(deps.now());
  const provider = await firstWithQuota(deps, day, promptChars);
  if (!provider) return { ...none, status: 'fallback', provider: null, failure: 'quota', excerpt: 'no quota left' };

  const estimate = worstCase(provider, promptChars, 'herald');
  const call = { fetch: deps.fetch, keys: deps.providers, timeoutMs: deps.timeoutMs ?? NARRATION.timeoutMs };
  const result = await callProvider(provider, call, messages, 'herald');
  const used = await settle(deps.sql, { day, provider }, estimate, result.usage);
  const spent = { neurons: used?.neurons ?? null, tokens: used?.tokens ?? null };
  const cut = (s: string) => s.slice(0, NARRATION.excerptChars);
  if (!result.ok) {
    return { ...spent, status: 'fallback', provider, failure: result.failure, excerpt: cut(`${provider} ${result.failure}: ${result.detail}`) };
  }
  const verdict = validateHerald(result.content, stories.map((s) => s.rank));
  if (!verdict.ok) {
    return {
      ...spent,
      status: 'fallback',
      provider,
      failure: verdict.failure,
      excerpt: cut(`${provider} ${verdict.failure} (${verdict.why}): ${result.content}`),
    };
  }

  // Only the written fields of the stories asked for; blame_line is not in this statement.
  await deps.sql.begin(async (tx) => {
    await tx`
      update edition_stories e
      set headline = s->>'headline', standfirst = s->>'standfirst', body = s->>'body'
      from jsonb_array_elements(${jsonb(tx, verdict.stories)}) as s
      where e.edition_id = ${job.edition_id} and e.rank = (s->>'rank')::smallint and e.slot <> 'gutter'`;
    await tx`update editions set status = 'generated' where id = ${job.edition_id} and status = 'templated'`;
  });
  return { ...spent, status: 'done', provider, failure: null, excerpt: null };
}

/** The first configured provider (D65 order) whose allowance takes the call, with it reserved. */
async function firstWithQuota(deps: NarrationDeps, day: string, promptChars: number) {
  for (const provider of ORDER.filter((p) => configured(deps.providers, p))) {
    if (await reserve(deps.sql, { day, provider, kind: 'herald' }, worstCase(provider, promptChars, 'herald'))) return provider;
  }
  return null;
}
