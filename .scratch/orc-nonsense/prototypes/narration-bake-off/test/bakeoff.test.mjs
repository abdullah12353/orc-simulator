import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBakeOff, mockProviders } from '../bakeoff.mjs';
import { FACTS } from '../fixtures/facts.mjs';
import { HERALDS } from '../fixtures/heralds.mjs';

test('a mock run produces one validated record per input per model, no retries', async () => {
  let fetches = 0;
  const providers = mockProviders({ onFetch: () => fetches++, timeoutMs: 50 });
  const run = await runBakeOff({ providers });
  const n = FACTS.length + HERALDS.length;
  assert.equal(run.results.length, n * 3);
  assert.equal(fetches, n * 3);
  assert.deepEqual(new Set(run.results.map((r) => r.model)), new Set(['@cf/google/gemma-4-26b-a4b-it', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'openai/gpt-oss-120b']));
  for (const r of run.results) {
    assert.ok(['ok', 'failed'].includes(r.status), r.inputId);
    if (r.status === 'failed') assert.ok(r.failure, `${r.model} ${r.inputId} failed without a reason`);
  }
  // The mock's personalities include each failure path.
  const failures = new Set(run.results.map((r) => r.failure).filter(Boolean));
  for (const f of ['refusal', 'timeout', 'loser_not_last', 'invalid_json']) assert.ok(failures.has(f), `no ${f} in mock run`);
});

test('every call in a run used the same prefix bytes', async () => {
  const run = await runBakeOff({ providers: mockProviders({ timeoutMs: 50 }) });
  assert.equal(new Set(run.results.map((r) => r.prefixSha)).size, 1);
  assert.equal(run.prefixSha, run.results[0].prefixSha);
});

test('the Groq cache finding comes out of a run', async () => {
  const run = await runBakeOff({ providers: mockProviders({ timeoutMs: 50 }) });
  assert.equal(run.groqCache.verdict, 'excluded');
  assert.ok(run.groqCache.pairs > 5);
});
