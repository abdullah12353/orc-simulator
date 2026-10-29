import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBakeOff, mockProviders } from '../bakeoff.mjs';
import { FACTS } from '../fixtures/facts.mjs';
import { HERALDS } from '../fixtures/heralds.mjs';

const noSleep = async () => {};
const CALIBRATION_VOICES = 7;

test('a mock run produces one validated record per input per model, no retries', async () => {
  let fetches = 0;
  const providers = mockProviders({ onFetch: () => fetches++, timeoutMs: 50 });
  const run = await runBakeOff({ providers, sleep: noSleep });
  const n = FACTS.length + HERALDS.length + CALIBRATION_VOICES;
  assert.equal(run.results.length, n * 3);
  assert.equal(fetches, n * 3);
  assert.deepEqual(new Set(run.results.map((r) => r.model)), new Set(['@cf/google/gemma-4-26b-a4b-it', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'openai/gpt-oss-120b']));
  for (const r of run.results) {
    assert.ok(['ok', 'failed'].includes(r.status), r.inputId);
    assert.equal(typeof r.transportOk, 'boolean');
    assert.equal('ok' in r, false);
    if (r.status === 'failed') assert.ok(r.failure, `${r.model} ${r.inputId} failed without a reason`);
  }
  // The mock's personalities include each failure path.
  const failures = new Set(run.results.map((r) => r.failure).filter(Boolean));
  for (const f of ['refusal', 'timeout', 'loser_not_last', 'invalid_json', 'http_429']) assert.ok(failures.has(f), `no ${f} in mock run`);
});

test('calibration inputs run for every §6 voice and are validated', async () => {
  const run = await runBakeOff({ providers: mockProviders({ timeoutMs: 50 }), sleep: noSleep });
  const cal = run.results.filter((r) => r.kind === 'calibration');
  assert.equal(cal.length, CALIBRATION_VOICES * 3);
  assert.ok(cal.some((r) => r.status === 'ok' && r.lines.length === 3));
});

test('Groq calls are paced; Workers AI calls are not', async () => {
  const waits = [];
  const run = await runBakeOff({ providers: mockProviders({ timeoutMs: 50 }), sleep: async (ms) => waits.push(ms) });
  const groqCalls = run.results.filter((r) => r.provider === 'groq').length;
  assert.equal(waits.length, groqCalls - 1);
  assert.ok(waits.every((ms) => ms >= 2100));
});

test('every call in a run used the same prefix bytes', async () => {
  const run = await runBakeOff({ providers: mockProviders({ timeoutMs: 50 }), sleep: noSleep });
  assert.equal(new Set(run.results.map((r) => r.prefixSha)).size, 1);
  assert.equal(run.prefixSha, run.results[0].prefixSha);
});

test('the Groq cache finding comes out of a run', async () => {
  const run = await runBakeOff({ providers: mockProviders({ timeoutMs: 50 }), sleep: noSleep });
  assert.equal(run.groqCache.verdict, 'excluded');
  assert.ok(run.groqCache.pairs > 5);
});
