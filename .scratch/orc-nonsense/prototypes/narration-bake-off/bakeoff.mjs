// Runs every input through every provider once, sequentially (so Groq's rate-limit headers
// come from consecutive calls), and validates each output. No retries.
import { createHash } from 'node:crypto';
import { loadPrefix, loadToneBible, buildClashMessages, buildHeraldMessages, buildCalibrationMessages, calibrationInputs, parseCalibrationSamples } from './prompt.mjs';
import { validateClash, validateHerald, validateCalibration } from './validate.mjs';
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
    out.push(createWorkersAi({ ...cf, model: MODELS.gemma, jsonMode: env.CF_GEMMA_JSON_MODE === '1', reasoning: true }));
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

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function validate(input, content) {
  if (input.kind === 'clash') return validateClash(content, input.fact);
  if (input.kind === 'calibration') return validateCalibration(content, input.calibration);
  return validateHerald(content);
}

export async function runBakeOff({ providers, facts = FACTS, heralds = HERALDS, calibrations, cast = CAST, onProgress, sleep = realSleep } = {}) {
  const prefix = loadPrefix();
  calibrations ??= calibrationInputs(parseCalibrationSamples(loadToneBible()), cast);
  const inputs = [
    ...calibrations.map((cal) => ({ id: cal.id, kind: 'calibration', calibration: cal, messages: buildCalibrationMessages(prefix, cal, cast) })),
    ...facts.map((fact) => ({ id: fact.id, kind: 'clash', fact, messages: buildClashMessages(prefix, fact, cast) })),
    ...heralds.map((herald) => ({ id: herald.id, kind: 'herald', herald, messages: buildHeraldMessages(prefix, herald) })),
  ];
  const results = [];
  for (const provider of providers) {
    let last = null;
    for (const input of inputs) {
      if (last) {
        const wait = provider.delayBeforeNext(last, input.messages, input.kind);
        if (wait > 0) await sleep(wait);
      }
      const startedAt = Date.now();
      const call = await provider.call(input.messages, input.kind);
      last = call;
      const verdict = call.ok ? validate(input, call.content) : null;
      const failure = call.ok ? (verdict.ok ? null : verdict.failure) : call.error;
      results.push({
        inputId: input.id, kind: input.kind, provider: provider.provider, model: provider.model, startedAt,
        prefixSha: sha(input.messages[0].content),
        transportOk: call.ok, status: failure ? 'failed' : 'ok', failure, detail: call.detail,
        content: call.content ?? null, lines: verdict?.lines, headline: verdict?.headline, body: verdict?.body,
        flags: verdict?.flags ?? [], softening: verdict?.softening ?? [],
        latencyMs: call.latencyMs, usage: call.usage, neurons: call.neurons, headers: call.headers,
        maxCompletionTokens: call.maxCompletionTokens,
      });
      onProgress?.(results.at(-1));
    }
  }
  const groqCalls = results.filter((r) => r.provider === 'groq');
  return {
    startedAt: new Date().toISOString(),
    prefixSha: sha(prefix),
    prefixChars: prefix.length,
    inputs: inputs.map(({ id, kind, fact, herald, calibration }) => ({ id, kind, fact, herald, calibration })),
    results,
    groqCache: groqCacheFinding(groqCalls),
  };
}
