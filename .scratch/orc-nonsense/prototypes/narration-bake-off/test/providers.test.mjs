import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkersAi, createGroq } from '../providers.mjs';

const msgs = [{ role: 'system', content: 'S' }, { role: 'user', content: '{"task":"clash"}' }];
const content = '{"lines":[]}';

function fakeFetch(responder) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return responder(url, init);
  };
  fetchFn.calls = calls;
  return fetchFn;
}
const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });

test('Workers AI: posts to the account run endpoint and reads response + usage', async () => {
  const fetch = fakeFetch(() => json({ success: true, result: { response: content, usage: { prompt_tokens: 1500, completion_tokens: 200, total_tokens: 1700 } } }));
  const p = createWorkersAi({ accountId: 'ACC', apiToken: 'TOK', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', fetch });
  const r = await p.call(msgs, 'clash');
  assert.equal(fetch.calls[0].url, 'https://api.cloudflare.com/client/v4/accounts/ACC/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  assert.equal(fetch.calls[0].init.headers.authorization, 'Bearer TOK');
  assert.deepEqual(fetch.calls[0].body.messages, msgs);
  assert.equal(r.ok, true);
  assert.equal(r.content, content);
  assert.deepEqual(r.usage, { prompt: 1500, completion: 200, cached: 0, reasoning: 0 });
  assert.ok(Math.abs(r.neurons - 81) < 1);
  assert.equal(typeof r.latencyMs, 'number');
});

test('Workers AI: an object response (JSON mode) and an OpenAI-shaped result both work', async () => {
  const p1 = createWorkersAi({ accountId: 'A', apiToken: 'T', model: '@cf/google/gemma-4-26b-a4b-it',
    fetch: fakeFetch(() => json({ success: true, result: { response: { lines: [] }, usage: {} } })) });
  assert.equal((await p1.call(msgs, 'clash')).content, content);
  const p2 = createWorkersAi({ accountId: 'A', apiToken: 'T', model: '@cf/google/gemma-4-26b-a4b-it',
    fetch: fakeFetch(() => json({ result: { choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 4 } } } })) });
  const r2 = await p2.call(msgs, 'clash');
  assert.equal(r2.content, content);
  assert.deepEqual(r2.usage, { prompt: 10, completion: 5, cached: 4, reasoning: 0 });
});

test('Workers AI: JSON mode sends a json_schema response_format only when enabled', async () => {
  const fetch = fakeFetch(() => json({ result: { response: content } }));
  await createWorkersAi({ accountId: 'A', apiToken: 'T', model: 'm', fetch, jsonMode: true }).call(msgs, 'clash');
  await createWorkersAi({ accountId: 'A', apiToken: 'T', model: 'm', fetch, jsonMode: false }).call(msgs, 'clash');
  assert.equal(fetch.calls[0].body.response_format.type, 'json_schema');
  assert.ok(fetch.calls[0].body.response_format.json_schema.properties.lines);
  assert.equal(fetch.calls[1].body.response_format, undefined);
});

test('Workers AI: a reasoning model gets thinking off and 4x the token budget', async () => {
  const fetch = fakeFetch(() => json({ result: { response: content } }));
  await createWorkersAi({ accountId: 'A', apiToken: 'T', model: 'm', fetch, reasoning: true }).call(msgs, 'clash');
  await createWorkersAi({ accountId: 'A', apiToken: 'T', model: 'm', fetch }).call(msgs, 'clash');
  assert.deepEqual(fetch.calls[0].body.chat_template_kwargs, { enable_thinking: false });
  assert.equal(fetch.calls[0].body.max_tokens, 512 * 4);
  assert.equal(fetch.calls[1].body.chat_template_kwargs, undefined);
  assert.equal(fetch.calls[1].body.max_tokens, 512);
});

test('Workers AI: thinking that eats the whole budget is a format failure, not transport', async () => {
  const fetch = fakeFetch(() => json({ result: { choices: [{ message: { content: null, reasoning: 'Task: calibration…' } }] } }));
  const r = await createWorkersAi({ accountId: 'A', apiToken: 'T', model: 'm', fetch, reasoning: true }).call(msgs, 'clash');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'reasoning_only');
});

test('an HTTP error is one failed call with no retry', async () => {
  const fetch = fakeFetch(() => json({ success: false, errors: [{ message: 'AiError: capacity temporarily exceeded' }] }, 400));
  const r = await createWorkersAi({ accountId: 'A', apiToken: 'T', model: 'm', fetch }).call(msgs, 'clash');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'http_400');
  assert.match(r.detail, /capacity/);
  assert.equal(fetch.calls.length, 1);
});

test('a timeout is recorded as a failure', async () => {
  const fetch = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  const r = await createGroq({ apiKey: 'K', fetch, timeoutMs: 20 }).call(msgs, 'clash');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'timeout');
});

test('Groq: strict json_schema, low reasoning, cached tokens and rate-limit headers', async () => {
  const fetch = fakeFetch(() => json(
    { choices: [{ message: { content } }], usage: { prompt_tokens: 1600, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 1280 }, completion_tokens_details: { reasoning_tokens: 90 } } },
    200,
    { 'x-ratelimit-remaining-tokens': '7400', 'x-ratelimit-limit-tokens': '8000', 'x-ratelimit-remaining-requests': '998', 'x-ratelimit-reset-tokens': '4.5s', 'retry-after': '2' },
  ));
  const r = await createGroq({ apiKey: 'K', fetch }).call(msgs, 'herald');
  const { url, init, body } = fetch.calls[0];
  assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(init.headers.authorization, 'Bearer K');
  assert.equal(body.model, 'openai/gpt-oss-120b');
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.ok(body.response_format.json_schema.schema.properties.headline);
  assert.deepEqual(r.usage, { prompt: 1600, completion: 300, cached: 1280, reasoning: 90 });
  assert.equal(r.neurons, null);
  assert.deepEqual(r.headers, { 'x-ratelimit-remaining-tokens': '7400', 'x-ratelimit-limit-tokens': '8000', 'x-ratelimit-remaining-requests': '998', 'x-ratelimit-reset-tokens': '4.5s', 'retry-after': '2' });
});

test('Workers AI: reasoning reported separately from completion is billed as output', async () => {
  const fetch = fakeFetch(() => json({ result: { response: content, usage: { prompt_tokens: 1500, completion_tokens: 200, reasoning_tokens: 200 } } }));
  const r = await createWorkersAi({ accountId: 'A', apiToken: 'T', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', fetch }).call(msgs, 'clash');
  // completion always includes reasoning: 1500 in, 400 out = 40.0 + 81.9.
  assert.deepEqual(r.usage, { prompt: 1500, completion: 400, cached: 0, reasoning: 200 });
  assert.ok(Math.abs(r.neurons - 121.9) < 0.1, String(r.neurons));
});

test('Workers AI: "JSON Mode couldn\'t be met" is a model format failure, not transport', async () => {
  const fetch = fakeFetch(() => json({ success: false, errors: [{ message: "JSON Mode couldn't be met" }] }, 400));
  const r = await createWorkersAi({ accountId: 'A', apiToken: 'T', model: 'm', fetch, jsonMode: true }).call(msgs, 'clash');
  assert.equal(r.error, 'json_mode_unmet');
});

test('every call records the max completion tokens it asked for', async () => {
  const fetch = fakeFetch(() => json({ choices: [{ message: { content } }], usage: {} }));
  const r = await createGroq({ apiKey: 'K', fetch }).call(msgs, 'clash');
  assert.equal(r.maxCompletionTokens, fetch.calls[0].body.max_completion_tokens);
});

test('Groq: a 429 is recorded as http_429 with its headers', async () => {
  const fetch = fakeFetch(() => json({ error: { message: 'Rate limit reached' } }, 429, { 'retry-after': '7', 'x-ratelimit-remaining-tokens': '0' }));
  const r = await createGroq({ apiKey: 'K', fetch }).call(msgs, 'clash');
  assert.equal(r.error, 'http_429');
  assert.equal(r.headers['retry-after'], '7');
  assert.equal(fetch.calls.length, 1);
});

test('Groq pacing: at least 2 s apart (30 RPM), longer when the token bucket is short', () => {
  const groq = createGroq({ apiKey: 'K', fetch: () => {} });
  const headers = (remaining, reset = '7.66s') => ({ 'x-ratelimit-remaining-tokens': String(remaining), 'x-ratelimit-reset-tokens': reset });
  // Plenty of tokens: just the RPM gap.
  assert.equal(groq.delayBeforeNext({ headers: headers(7000) }, msgs, 'clash'), 2100);
  // Not enough tokens for the next call (prompt + max completion): wait for the bucket reset.
  assert.equal(groq.delayBeforeNext({ headers: headers(500, '7.66s') }, msgs, 'clash'), 7660);
  assert.equal(groq.delayBeforeNext({ headers: headers(500, '1m2s') }, msgs, 'clash'), 62_000);
  // A retry-after from a 429 wins if longer.
  assert.equal(groq.delayBeforeNext({ headers: { 'retry-after': '12' } }, msgs, 'clash'), 12_000);
  // No headers (transport error): just the RPM gap.
  assert.equal(groq.delayBeforeNext({ headers: {} }, msgs, 'clash'), 2100);
});

test('Workers AI needs no pacing at this volume', () => {
  assert.equal(createWorkersAi({ accountId: 'A', apiToken: 'T', model: 'm', fetch: () => {} }).delayBeforeNext({}, msgs, 'clash'), 0);
});

test('Groq: a refusal field is a refusal failure', async () => {
  const fetch = fakeFetch(() => json({ choices: [{ message: { content: null, refusal: 'I can\'t help with that.' } }], usage: {} }));
  const r = await createGroq({ apiKey: 'K', fetch }).call(msgs, 'clash');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'refusal');
});
