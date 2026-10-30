// The $0 quota router (D37, data-model decision 13). `llm_usage` holds one row per UTC day and provider.
// A call first reserves its worst case with one conditional UPDATE … RETURNING (so concurrent drains
// can't both take the last of an allowance), then settles to what the provider reported.
import type { Sql, Tx } from '../db.ts';
import { MAX_TOKENS, MODELS, type NarrationTask, type ProviderId, type Usage } from './providers.ts';

/**
 * Workers AI gives 10k Neurons a day; Clash calls move to Groq at about 9k. Groq's free gpt-oss-120b
 * allows 1k requests and 200k tokens a day; Clash jobs stop short of a reserve kept for the Herald (#38).
 */
export const QUOTA = {
  workersAi: { dailyNeurons: 10_000, switchAt: 9_000 },
  groq: { requestsPerDay: 1_000, tokensPerDay: 200_000, heraldReserve: { requests: 100, tokens: 40_000 } },
} as const;

/**
 * Neurons per 1M tokens, per model. Gemma's is solved back from #12's per-Clash figures, so it's an
 * estimate: read the real rate off the Cloudflare dashboard after the first live calls and fix it here.
 */
export const NEURON_RATES: Record<string, { in: number; out: number }> = {
  '@cf/google/gemma-4-26b-a4b-it': { in: 8_667, out: 30_000 },
};

/** Neurons a call cost (whole Neurons, rounded up). 0 for a model that isn't billed in Neurons. */
export function neuronsFor(model: string, usage: Usage): number {
  const rate = NEURON_RATES[model];
  if (!rate) return 0;
  return Math.ceil((usage.prompt * rate.in + usage.completion * rate.out) / 1e6);
}

/** Who's asking: Clash jobs can't spend the Groq Herald reserve; the Herald can. */
export type QuotaKind = 'clash' | 'herald';

/** What a call is reserved at before it's made: its prompt (about 4 characters a token) and its full budget. */
export function worstCase(provider: ProviderId, promptChars: number, task: NarrationTask = 'clash'): Usage {
  return { prompt: Math.ceil(promptChars / 4), completion: MAX_TOKENS[task][provider] };
}

const NO_LIMIT = 2 ** 31 - 1;

/** The UTC date, the providers' daily reset. */
export const usageDay = (now: Date) => now.toISOString().slice(0, 10);

/** Reserves one call's worst case. False: the provider's allowance (for this kind) can't take it. */
export async function reserve(
  sql: Sql | Tx,
  at: { day: string; provider: ProviderId; kind: QuotaKind },
  estimate: Usage,
): Promise<boolean> {
  const neurons = neuronsFor(MODELS[at.provider], estimate);
  const tokens = estimate.prompt + estimate.completion;
  const caps =
    at.provider === 'workers-ai'
      ? { neurons: QUOTA.workersAi.switchAt, requests: NO_LIMIT, tokens: NO_LIMIT }
      : {
          neurons: NO_LIMIT,
          requests: QUOTA.groq.requestsPerDay - (at.kind === 'clash' ? QUOTA.groq.heraldReserve.requests : 0),
          tokens: QUOTA.groq.tokensPerDay - (at.kind === 'clash' ? QUOTA.groq.heraldReserve.tokens : 0),
        };
  await sql`insert into llm_usage (day, provider) values (${at.day}, ${at.provider}) on conflict do nothing`;
  const rows = await sql`
    update llm_usage set neurons = neurons + ${neurons}, requests = requests + 1, tokens = tokens + ${tokens}
    where day = ${at.day} and provider = ${at.provider}
      and neurons + ${neurons} <= ${caps.neurons} and requests + 1 <= ${caps.requests} and tokens + ${tokens} <= ${caps.tokens}
    returning 1`;
  return rows.length === 1;
}

/** Replaces a reservation with what the call really used. Without reported usage the reservation stands. */
export async function settle(
  sql: Sql | Tx,
  at: { day: string; provider: ProviderId },
  estimate: Usage,
  actual: Usage | null,
): Promise<{ neurons: number; tokens: number } | null> {
  if (!actual) return null;
  const model = MODELS[at.provider];
  const neurons = neuronsFor(model, actual);
  const tokens = actual.prompt + actual.completion;
  await sql`
    update llm_usage
    set neurons = neurons + ${neurons - neuronsFor(model, estimate)},
        tokens = tokens + ${tokens - (estimate.prompt + estimate.completion)}
    where day = ${at.day} and provider = ${at.provider}`;
  return { neurons, tokens };
}
