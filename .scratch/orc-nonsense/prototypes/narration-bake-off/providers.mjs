// Provider adapters. One call = one HTTP request. No retries, ever: a failure is a data point.
import { estimateNeurons } from './neurons.mjs';

// Strict-mode friendly (all properties required, no extras). Kept fixed per task kind.
export const SCHEMAS = {
  clash: {
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
  },
  herald: {
    type: 'object',
    properties: { headline: { type: 'string' }, body: { type: 'string' } },
    required: ['headline', 'body'],
    additionalProperties: false,
  },
};

const MAX_TOKENS = { clash: 512, herald: 900 };

function usageOf(u = {}) {
  return {
    prompt: u.prompt_tokens ?? u.input_tokens ?? 0,
    completion: u.completion_tokens ?? u.output_tokens ?? 0,
    cached: u.prompt_tokens_details?.cached_tokens ?? 0,
    reasoning: u.completion_tokens_details?.reasoning_tokens ?? 0,
  };
}

async function timedPost({ fetch, url, headers, body, timeoutMs }) {
  const t0 = performance.now();
  const ctrl = new AbortController();
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

export function createWorkersAi({ accountId, apiToken, model, fetch = globalThis.fetch, timeoutMs = 30_000, jsonMode = false }) {
  return {
    provider: 'workers-ai',
    model,
    async call(messages, kind) {
      const body = { messages, max_tokens: MAX_TOKENS[kind] };
      if (jsonMode) body.response_format = { type: 'json_schema', json_schema: SCHEMAS[kind] };
      const r = await timedPost({
        fetch,
        url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
        headers: { authorization: `Bearer ${apiToken}` },
        body,
        timeoutMs,
      });
      const base = { latencyMs: r.latencyMs, usage: usageOf(), neurons: null, headers: {} };
      if (r.error) return failed(base, r.error, r.detail);
      if (!r.res.ok) return failed(base, `http_${r.res.status}`, r.text);
      const result = r.data?.result ?? {};
      const usage = usageOf(result.usage);
      let content = result.response ?? result.choices?.[0]?.message?.content;
      if (content && typeof content === 'object') content = JSON.stringify(content);
      const out = { ...base, usage, neurons: estimateNeurons(model, usage) };
      if (typeof content !== 'string') return failed(out, 'empty', r.text);
      return { ...out, ok: true, content };
    },
  };
}

const GROQ_HEADERS = [
  'x-ratelimit-limit-requests', 'x-ratelimit-limit-tokens',
  'x-ratelimit-remaining-requests', 'x-ratelimit-remaining-tokens',
  'x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens', 'retry-after',
];

export function createGroq({ apiKey, model = 'openai/gpt-oss-120b', fetch = globalThis.fetch, timeoutMs = 30_000 }) {
  return {
    provider: 'groq',
    model,
    async call(messages, kind) {
      const r = await timedPost({
        fetch,
        url: 'https://api.groq.com/openai/v1/chat/completions',
        headers: { authorization: `Bearer ${apiKey}` },
        body: {
          model,
          messages,
          reasoning_effort: 'low',
          max_completion_tokens: MAX_TOKENS[kind] * 2,
          response_format: { type: 'json_schema', json_schema: { name: kind, strict: true, schema: SCHEMAS[kind] } },
        },
        timeoutMs,
      });
      const headers = {};
      for (const h of GROQ_HEADERS) {
        const v = r.res?.headers.get(h);
        if (v != null) headers[h] = v;
      }
      const usage = usageOf(r.data?.usage);
      const base = { latencyMs: r.latencyMs, usage, neurons: null, headers };
      if (r.error) return failed(base, r.error, r.detail);
      if (!r.res.ok) return failed(base, `http_${r.res.status}`, r.text);
      const msg = r.data?.choices?.[0]?.message ?? {};
      if (msg.refusal) return failed(base, 'refusal', msg.refusal);
      if (typeof msg.content !== 'string') return failed(base, 'empty', r.text);
      return { ...base, ok: true, content: msg.content };
    },
  };
}
