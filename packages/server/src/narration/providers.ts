// The two narration providers: Workers AI through the Worker's `AI` binding, Groq over an injected
// `fetch` (tests fake both). One call is one request: nothing here retries. Adapted from #13's bake-off
// (`providers.mjs`).
import type { ChatMessage } from './prompt.ts';
import type { NarrationFailure } from './validate.ts';

export type ProviderId = 'workers-ai' | 'groq';

/** The models (D65): Gemma 4 26B on Workers AI with thinking off, Groq gpt-oss-120b as the fallback. */
export const MODELS: Record<ProviderId, string> = {
  'workers-ai': '@cf/google/gemma-4-26b-a4b-it',
  groq: 'openai/gpt-oss-120b',
};

/**
 * The part of the Worker's Workers AI binding (`env.AI`, #62 item 3) narration uses. `run` resolves to
 * what the REST API returns as `result`: `{ response, usage }`, or `{ choices, usage }`.
 */
export interface WorkersAi {
  run(model: string, inputs: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>;
}

/**
 * How to reach each provider: the `AI` binding, and the `GROQ_API_KEY` secret. A provider left out is
 * skipped, so with neither every Clash keeps its fallback and no call is made.
 */
export interface ProviderKeys {
  workersAi?: WorkersAi;
  groq?: { apiKey: string };
}

export const configured = (keys: ProviderKeys, p: ProviderId) => (p === 'workers-ai' ? !!keys.workersAi : !!keys.groq);

/** What a call writes: one Clash's dialogue, or one Herald edition's headlines, standfirsts and bodies. */
export type NarrationTask = 'clash' | 'herald';

/**
 * Completion budgets. gpt-oss spends part of its budget reasoning, so Groq gets more. A Herald edition
 * is up to 8 stories of three fields each.
 */
export const MAX_TOKENS: Record<NarrationTask, Record<ProviderId, number>> = {
  clash: { 'workers-ai': 1024, groq: 2048 },
  herald: { 'workers-ai': 2048, groq: 3072 },
};

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

const CLASH_SCHEMA = {
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

/** Groq's strict mode needs every property required; a non-lead story may leave its standfirst empty. */
const HERALD_SCHEMA = {
  type: 'object',
  properties: {
    stories: {
      type: 'array',
      items: {
        type: 'object',
        properties: { rank: { type: 'integer' }, headline: { type: 'string' }, standfirst: { type: 'string' }, body: { type: 'string' } },
        required: ['rank', 'headline', 'standfirst', 'body'],
        additionalProperties: false,
      },
    },
  },
  required: ['stories'],
  additionalProperties: false,
};

const SCHEMAS: Record<NarrationTask, object> = { clash: CLASH_SCHEMA, herald: HERALD_SCHEMA };

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

export async function callProvider(
  provider: ProviderId,
  deps: CallDeps,
  messages: ChatMessage[],
  task: NarrationTask = 'clash',
): Promise<CallResult> {
  return provider === 'workers-ai' ? callWorkersAi(deps, messages, task) : callGroq(deps, messages, task);
}

/** The binding's answer, or its error, within `timeoutMs` (the signal is passed on, and raced in case it's ignored). */
async function runWorkersAi(deps: CallDeps, inputs: Record<string, unknown>): Promise<{ result: unknown } | { error: string }> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<{ error: string }>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort(new DOMException('timed out', 'TimeoutError'));
      resolve({ error: 'timed out' });
    }, deps.timeoutMs);
  });
  const call = deps.keys
    .workersAi!.run(MODELS['workers-ai'], inputs, { signal: ctrl.signal })
    .then((result) => ({ result }), (e: unknown) => ({ error: String((e as Error)?.message ?? e) }));
  try {
    return await Promise.race([call, timedOut]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function callWorkersAi(deps: CallDeps, messages: ChatMessage[], task: NarrationTask): Promise<CallResult> {
  const out = await runWorkersAi(deps, {
    messages,
    max_tokens: MAX_TOKENS[task]['workers-ai'],
    // Gemma 4 thinks by default and spends the whole budget doing it (#13).
    chat_template_kwargs: { enable_thinking: false },
  });
  // The binding throws for what the REST API answered with an HTTP error (out of Neurons, rate limits).
  if ('error' in out) {
    const failure = /timed out|abort/i.test(out.error) ? 'timeout' : httpFailure(0, out.error);
    return { ok: false, failure, detail: out.error, usage: null };
  }
  const result = (out.result ?? {}) as { response?: unknown; usage?: Record<string, unknown>; choices?: { message?: { content?: unknown } }[] };
  const usage = usageOf(result.usage);
  let content = result.response ?? result.choices?.[0]?.message?.content;
  if (content && typeof content === 'object') content = JSON.stringify(content);
  if (typeof content !== 'string' || !content.trim()) return { ok: false, failure: 'bad_output', detail: `empty: ${JSON.stringify(out.result)}`, usage };
  return { ok: true, content, usage };
}

async function callGroq(deps: CallDeps, messages: ChatMessage[], task: NarrationTask): Promise<CallResult> {
  const out = await post(deps, 'https://api.groq.com/openai/v1/chat/completions', deps.keys.groq!.apiKey, {
    model: MODELS.groq,
    messages,
    reasoning_effort: 'low',
    max_completion_tokens: MAX_TOKENS[task].groq,
    response_format: { type: 'json_schema', json_schema: { name: task, strict: true, schema: SCHEMAS[task] } },
  });
  if ('error' in out) return { ok: false, failure: 'timeout', detail: out.error!, usage: null };
  const usage = usageOf(out.data?.usage as Record<string, unknown> | undefined);
  if (!out.res.ok) return { ok: false, failure: httpFailure(out.res.status, out.text), detail: `http ${out.res.status}: ${out.text}`, usage };
  const message = ((out.data?.choices as { message?: { content?: unknown; refusal?: unknown } }[] | undefined)?.[0]?.message ?? {});
  if (message.refusal) return { ok: false, failure: 'refusal', detail: String(message.refusal), usage };
  if (typeof message.content !== 'string' || !message.content.trim()) return { ok: false, failure: 'bad_output', detail: `empty: ${out.text}`, usage };
  return { ok: true, content: message.content, usage };
}

/** The providers from the Worker's environment: the `AI` binding and the `GROQ_API_KEY` secret. Either may be missing. */
export function providerKeysFromEnv(env: { AI?: WorkersAi; GROQ_API_KEY?: string }): ProviderKeys {
  return {
    ...(env.AI ? { workersAi: env.AI } : {}),
    ...(env.GROQ_API_KEY ? { groq: { apiKey: env.GROQ_API_KEY } } : {}),
  };
}
