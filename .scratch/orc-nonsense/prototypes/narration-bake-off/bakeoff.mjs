// Runs every input through every provider once, sequentially (so Groq's rate-limit headers
// come from consecutive calls), and validates each output. No retries.
import { createHash } from 'node:crypto';
import { loadPrefix, buildClashMessages, buildHeraldMessages } from './prompt.mjs';
import { validateClash, validateHerald } from './validate.mjs';
import { createWorkersAi, createGroq } from './providers.mjs';
import { createMockFetch } from './mock.mjs';
import { groqCacheFinding } from './cache.mjs';
import { CAST } from './fixtures/cast.mjs';
import { FACTS } from './fixtures/facts.mjs';
import { HERALDS } from './fixtures/heralds.mjs';

export const MODELS = {
  gemma: '@cf/google/gemma-4-26b-a4b-it',
  llama: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  groq: 'openai/gpt-oss-120b',
};

// JSON mode is documented for Llama 3.3 on Workers AI; for Gemma 4 it isn't, so it's off unless asked for.
export function realProviders(env = process.env, { timeoutMs = 30_000 } = {}) {
  const out = [];
  if (env.CF_ACCOUNT_ID && env.CF_API_TOKEN) {
    const cf = { accountId: env.CF_ACCOUNT_ID, apiToken: env.CF_API_TOKEN, timeoutMs };
    out.push(createWorkersAi({ ...cf, model: MODELS.gemma, jsonMode: env.CF_GEMMA_JSON_MODE === '1' }));
    out.push(createWorkersAi({ ...cf, model: MODELS.llama, jsonMode: env.CF_LLAMA_JSON_MODE !== '0' }));
  }
  if (env.GROQ_API_KEY) out.push(createGroq({ apiKey: env.GROQ_API_KEY, model: MODELS.groq, timeoutMs }));
  return out;
}

export function mockProviders({ onFetch, timeoutMs = 2_000 } = {}) {
  const mock = createMockFetch();
  const fetch = (url, init) => { onFetch?.(url, init); return mock(url, init); };
  const cf = { accountId: 'MOCK', apiToken: 'MOCK', fetch, timeoutMs };
  return [
    createWorkersAi({ ...cf, model: MODELS.gemma }),
    createWorkersAi({ ...cf, model: MODELS.llama, jsonMode: true }),
    createGroq({ apiKey: 'MOCK', model: MODELS.groq, fetch, timeoutMs }),
  ];
}

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

export async function runBakeOff({ providers, facts = FACTS, heralds = HERALDS, cast = CAST, onProgress } = {}) {
  const prefix = loadPrefix();
  const inputs = [
    ...facts.map((f) => ({ id: f.id, kind: 'clash', fact: f, messages: buildClashMessages(prefix, f, cast) })),
    ...heralds.map((h) => ({ id: h.id, kind: 'herald', herald: h, messages: buildHeraldMessages(prefix, h) })),
  ];
  const results = [];
  for (const p of providers) {
    for (const input of inputs) {
      const startedAt = Date.now();
      const call = await p.call(input.messages, input.kind);
      const v = call.ok ? (input.kind === 'clash' ? validateClash(call.content, input.fact) : validateHerald(call.content)) : null;
      const failure = call.ok ? (v.ok ? null : v.failure) : call.error;
      results.push({
        inputId: input.id, kind: input.kind, provider: p.provider, model: p.model, startedAt,
        prefixSha: sha(input.messages[0].content),
        ok: call.ok, status: failure ? 'failed' : 'ok', failure, detail: call.detail,
        content: call.content ?? null, lines: v?.lines, headline: v?.headline, body: v?.body,
        flags: v?.flags ?? [], softening: v?.softening ?? [],
        latencyMs: call.latencyMs, usage: call.usage, neurons: call.neurons, headers: call.headers,
      });
      onProgress?.(results.at(-1));
    }
  }
  const groqCalls = results.filter((r) => r.provider === 'groq');
  return {
    startedAt: new Date().toISOString(),
    prefixSha: sha(prefix),
    prefixChars: prefix.length,
    inputs: inputs.map(({ id, kind, fact, herald }) => ({ id, kind, fact, herald })),
    results,
    groqCache: groqCacheFinding(groqCalls),
  };
}
