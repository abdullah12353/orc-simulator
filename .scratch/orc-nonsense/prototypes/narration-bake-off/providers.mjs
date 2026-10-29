// Provider adapters. One call = one HTTP request. No retries, ever: a failure is a data point.
import { estimateNeurons } from './neurons.mjs';

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

// Strict-mode friendly (all properties required, no extras). Kept fixed per task kind.
export const SCHEMAS = {
  clash: LINES_SCHEMA,
  calibration: LINES_SCHEMA,
  herald: {
    type: 'object',
    properties: { headline: { type: 'string' }, body: { type: 'string' } },
    required: ['headline', 'body'],
    additionalProperties: false,
  },
};

const MAX_TOKENS = { clash: 512, calibration: 400, herald: 900 };
// gpt-oss spends part of its completion budget on reasoning, so Groq gets double.
const GROQ_MAX_TOKENS = Object.fromEntries(Object.entries(MAX_TOKENS).map(([kind, n]) => [kind, n * 2]));

// Normalised usage. Invariant: `completion` INCLUDES reasoning tokens. OpenAI-style
// completion_tokens_details.reasoning_tokens is already inside completion_tokens; a top-level
// reasoning_tokens is treated as reported separately and added in, so it's billed as output.
function usageOf(usage = {}) {
  const separateReasoning = usage.reasoning_tokens ?? 0;
  return {
    prompt: usage.prompt_tokens ?? usage.input_tokens ?? 0,
    completion: (usage.completion_tokens ?? usage.output_tokens ?? 0) + separateReasoning,
    cached: usage.prompt_tokens_details?.cached_tokens ?? 0,
    reasoning: usage.completion_tokens_details?.reasoning_tokens ?? separateReasoning,
  };
}

async function timedPost({ fetch, url, headers, body, timeoutMs }) {
  const t0 = performance.now();
  const ctrl = new AbortController();
  // A ref'd timer (AbortSignal.timeout's isn't), so a hung request can't let the process exit early.
  const timer = setTimeout(() => ctrl.abort(new DOMException('timed out', 'TimeoutError')), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    return { res, text, data, latencyMs: Math.round(performance.now() - t0) };
  } catch (e) {
    const latencyMs = Math.round(performance.now() - t0);
    const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    return { error: timeout ? 'timeout' : 'network', detail: String(e?.message ?? e), latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

function failed(base, error, detail) {
  return { ...base, ok: false, error, detail: detail?.slice(0, 500) };
}

// Gemma 4 is a reasoning model: on the first real run it spent the whole budget thinking and returned content: null.
// chat_template_kwargs is listed on its model page with undocumented keys; enable_thinking is the usual one. The 4x
// budget leaves room to answer if the switch is ignored (the extra thinking then shows up as output Neurons).
export function createWorkersAi({ accountId, apiToken, model, fetch = globalThis.fetch, timeoutMs = 30_000, jsonMode = false, reasoning = false }) {
  return {
    provider: 'workers-ai',
    model,
    // 300 requests/minute and a daily Neuron allowance: no pacing needed for ~40 sequential calls.
    delayBeforeNext: () => 0,
    async call(messages, kind) {
      const body = { messages, max_tokens: MAX_TOKENS[kind] * (reasoning ? 4 : 1) };
      if (reasoning) body.chat_template_kwargs = { enable_thinking: false };
      if (jsonMode) body.response_format = { type: 'json_schema', json_schema: SCHEMAS[kind] };
      const res = await timedPost({
        fetch,
        url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
        headers: { authorization: `Bearer ${apiToken}` },
        body,
        timeoutMs,
      });
      const base = { latencyMs: res.latencyMs, usage: usageOf(), neurons: null, headers: {}, maxCompletionTokens: body.max_tokens };
      if (res.error) return failed(base, res.error, res.detail);
      if (!res.res.ok) {
        // The model couldn't produce schema-valid JSON: that's the model's format failure, not transport.
        const error = /JSON Mode couldn.?t be met/i.test(res.text) ? 'json_mode_unmet' : `http_${res.res.status}`;
        return failed(base, error, res.text);
      }
      const result = res.data?.result ?? {};
      const usage = usageOf(result.usage);
      let content = result.response ?? result.choices?.[0]?.message?.content;
      if (content && typeof content === 'object') content = JSON.stringify(content);
      const out = { ...base, usage, neurons: estimateNeurons(model, usage) };
      if (typeof content !== 'string' || !content.trim()) {
        const thoughtOnly = result.choices?.[0]?.message?.reasoning;
        return failed(out, thoughtOnly ? 'reasoning_only' : 'empty', res.text);
      }
      return { ...out, ok: true, content };
    },
  };
}

const GROQ_HEADERS = [
  'x-ratelimit-limit-requests', 'x-ratelimit-limit-tokens',
  'x-ratelimit-remaining-requests', 'x-ratelimit-remaining-tokens',
  'x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens', 'retry-after',
];

// Groq reset headers look like "7.66s", "1m26s" or "250ms".
export function durationMs(text) {
  if (!text) return 0;
  let ms = 0;
  for (const [, n, unit] of String(text).matchAll(/([\d.]+)(ms|h|m|s)/g)) {
    ms += Number(n) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[unit];
  }
  return Math.round(ms);
}

const GROQ_MIN_GAP_MS = 2100; // 30 RPM, with a little slack.
const estimateTokens = (messages) => Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 4);

export function createGroq({ apiKey, model = 'openai/gpt-oss-120b', fetch = globalThis.fetch, timeoutMs = 30_000 }) {
  return {
    provider: 'groq',
    model,
    // Stay under 30 RPM and 8K TPM: always the RPM gap; if the token bucket can't fit the next call
    // (full prompt + max completion, the worst case), wait for its reset; honour retry-after.
    delayBeforeNext(last, nextMessages, nextKind) {
      const headers = last?.headers ?? {};
      let wait = GROQ_MIN_GAP_MS;
      const remaining = headers['x-ratelimit-remaining-tokens'];
      if (remaining != null && Number(remaining) < estimateTokens(nextMessages) + GROQ_MAX_TOKENS[nextKind]) {
        wait = Math.max(wait, durationMs(headers['x-ratelimit-reset-tokens']));
      }
      if (headers['x-ratelimit-remaining-requests'] === '0') wait = Math.max(wait, durationMs(headers['x-ratelimit-reset-requests']));
      if (headers['retry-after']) wait = Math.max(wait, Number(headers['retry-after']) * 1000);
      return wait;
    },
    async call(messages, kind) {
      const maxCompletionTokens = GROQ_MAX_TOKENS[kind];
      const res = await timedPost({
        fetch,
        url: 'https://api.groq.com/openai/v1/chat/completions',
        headers: { authorization: `Bearer ${apiKey}` },
        body: {
          model,
          messages,
          reasoning_effort: 'low',
          max_completion_tokens: maxCompletionTokens,
          response_format: { type: 'json_schema', json_schema: { name: kind, strict: true, schema: SCHEMAS[kind] } },
        },
        timeoutMs,
      });
      const headers = {};
      for (const name of GROQ_HEADERS) {
        const value = res.res?.headers.get(name);
        if (value != null) headers[name] = value;
      }
      const usage = usageOf(res.data?.usage);
      const base = { latencyMs: res.latencyMs, usage, neurons: null, headers, maxCompletionTokens };
      if (res.error) return failed(base, res.error, res.detail);
      if (!res.res.ok) return failed(base, `http_${res.res.status}`, res.text);
      const msg = res.data?.choices?.[0]?.message ?? {};
      if (msg.refusal) return failed(base, 'refusal', msg.refusal);
      if (typeof msg.content !== 'string') return failed(base, 'empty', res.text);
      return { ...base, ok: true, content: msg.content };
    },
  };
}
