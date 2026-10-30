// The two narration providers, reached through an injected `fetch` (tests fake it). One call is one
// HTTP request: nothing here retries. Adapted from #13's bake-off (`providers.mjs`).
import type { ChatMessage } from './prompt.ts';
import type { NarrationFailure } from './validate.ts';

export type ProviderId = 'workers-ai' | 'groq';

/** The models (D65): Gemma 4 26B on Workers AI with thinking off, Groq gpt-oss-120b as the fallback. */
export const MODELS: Record<ProviderId, string> = {
  'workers-ai': '@cf/google/gemma-4-26b-a4b-it',
  groq: 'openai/gpt-oss-120b',
};

/**
 * Provider credentials, from Edge Function secrets (`CF_ACCOUNT_ID` + `CF_AI_TOKEN`, `GROQ_API_KEY`). A
 * provider without keys is skipped, so with neither set every Clash keeps its fallback and no call is made.
 */
export interface ProviderKeys {
  workersAi?: { accountId: string; apiToken: string };
  groq?: { apiKey: string };
}

export const configured = (keys: ProviderKeys, p: ProviderId) => (p === 'workers-ai' ? !!keys.workersAi : !!keys.groq);

/** Completion budgets. gpt-oss spends part of its budget reasoning, so Groq gets more. */
export const MAX_TOKENS: Record<ProviderId, number> = { 'workers-ai': 1024, groq: 2048 };

/** Token usage as the provider reported it. `completion` includes any reasoning tokens. */
export interface Usage {
  prompt: number;
  completion: number;
}

export type CallResult =
  | { ok: true; content: string; usage: Usage | null }
  | { ok: false; failure: NarrationFailure; detail: string; usage: Usage | null };

export interface CallDeps {
  fetch: typeof fetch;
  keys: ProviderKeys;
  timeoutMs: number;
}

const LINES_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: { speaker: { type: 'string' }, text: { type: 'string' } },
        required: ['speaker', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['lines'],
  additionalProperties: false,
};

function usageOf(u: Record<string, unknown> | undefined): Usage | null {
  if (!u) return null;
  const n = (k: string) => (typeof u[k] === 'number' ? (u[k] as number) : 0);
  // A top-level reasoning_tokens is reported separately and bills as output; OpenAI-style details are
  // already inside completion_tokens.
  return { prompt: n('prompt_tokens') || n('input_tokens'), completion: (n('completion_tokens') || n('output_tokens')) + n('reasoning_tokens') };
}

async function post(deps: CallDeps, url: string, token: string, body: unknown) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('timed out', 'TimeoutError')), deps.timeoutMs);
  try {
    const res = await deps.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data: Record<string, unknown> | null = null;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {}
    return { res, text, data };
  } catch (e) {
    return { error: String((e as Error)?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

/** A non-OK HTTP answer: out of allowance or rate-limited is `quota`; anything else is transport, like a timeout. */
function httpFailure(status: number, text: string): NarrationFailure {
  if (status === 429 || /neuron|quota|allocation|rate.?limit/i.test(text)) return 'quota';
  if (/JSON Mode couldn.?t be met/i.test(text)) return 'bad_output';
  return 'timeout';
}

export async function callProvider(provider: ProviderId, deps: CallDeps, messages: ChatMessage[]): Promise<CallResult> {
  return provider === 'workers-ai' ? callWorkersAi(deps, messages) : callGroq(deps, messages);
}

async function callWorkersAi(deps: CallDeps, messages: ChatMessage[]): Promise<CallResult> {
  const keys = deps.keys.workersAi!;
  const out = await post(deps, `https://api.cloudflare.com/client/v4/accounts/${keys.accountId}/ai/run/${MODELS['workers-ai']}`, keys.apiToken, {
    messages,
    max_tokens: MAX_TOKENS['workers-ai'],
    // Gemma 4 thinks by default and spends the whole budget doing it (#13).
    chat_template_kwargs: { enable_thinking: false },
  });
  if ('error' in out) return { ok: false, failure: 'timeout', detail: out.error!, usage: null };
  if (!out.res.ok) return { ok: false, failure: httpFailure(out.res.status, out.text), detail: `http ${out.res.status}: ${out.text}`, usage: null };
  const result = (out.data?.result ?? {}) as { response?: unknown; usage?: Record<string, unknown>; choices?: { message?: { content?: unknown } }[] };
  const usage = usageOf(result.usage);
  let content = result.response ?? result.choices?.[0]?.message?.content;
  if (content && typeof content === 'object') content = JSON.stringify(content);
  if (typeof content !== 'string' || !content.trim()) return { ok: false, failure: 'bad_output', detail: `empty: ${out.text}`, usage };
  return { ok: true, content, usage };
}

async function callGroq(deps: CallDeps, messages: ChatMessage[]): Promise<CallResult> {
  const out = await post(deps, 'https://api.groq.com/openai/v1/chat/completions', deps.keys.groq!.apiKey, {
    model: MODELS.groq,
    messages,
    reasoning_effort: 'low',
    max_completion_tokens: MAX_TOKENS.groq,
    response_format: { type: 'json_schema', json_schema: { name: 'clash', strict: true, schema: LINES_SCHEMA } },
  });
  if ('error' in out) return { ok: false, failure: 'timeout', detail: out.error!, usage: null };
  const usage = usageOf(out.data?.usage as Record<string, unknown> | undefined);
  if (!out.res.ok) return { ok: false, failure: httpFailure(out.res.status, out.text), detail: `http ${out.res.status}: ${out.text}`, usage };
  const message = ((out.data?.choices as { message?: { content?: unknown; refusal?: unknown } }[] | undefined)?.[0]?.message ?? {});
  if (message.refusal) return { ok: false, failure: 'refusal', detail: String(message.refusal), usage };
  if (typeof message.content !== 'string' || !message.content.trim()) return { ok: false, failure: 'bad_output', detail: `empty: ${out.text}`, usage };
  return { ok: true, content: message.content, usage };
}
