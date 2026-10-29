import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groqCacheFinding } from '../cache.mjs';

// usage.completion includes reasoning tokens (OpenAI/Groq convention).
const call = (startedAt, remaining, { prompt = 1600, cached = 1280, completion = 300, maxCompletionTokens = 1024, status = 'ok', failure = null } = {}) => ({
  status, failure, startedAt, maxCompletionTokens, usage: { prompt, cached, completion, reasoning: 0 },
  headers: { 'x-ratelimit-remaining-tokens': String(remaining), 'x-ratelimit-limit-tokens': '8000' },
});

// With these defaults: excluded range is 620..1344 (actual..reserved), counted range is 1900..2624.
test('a drop matching only the uncached tokens says cached tokens are excluded', () => {
  const f = groqCacheFinding([call(0, 6100), call(0, 5480), call(0, 4860)]);
  assert.equal(f.pairs, 2);
  assert.equal(f.excluded, 2);
  assert.equal(f.counted, 0);
  assert.equal(f.verdict, 'excluded');
});

test('a drop matching uncached prompt + the reserved max_completion_tokens is still excluded', () => {
  // 320 uncached prompt + 1024 reserved = 1344.
  const f = groqCacheFinding([call(0, 6100), call(0, 6100 - 1344)]);
  assert.equal(f.verdict, 'excluded');
});

test('a drop matching the full count (actual or reserved) says cached tokens are counted', () => {
  assert.equal(groqCacheFinding([call(0, 6100), call(0, 4200)]).verdict, 'counted');
  assert.equal(groqCacheFinding([call(0, 6100), call(0, 6100 - 2624)]).verdict, 'counted');
});

test('TPM refill between calls is credited back before judging', () => {
  // 6 s gap refills 8000/60*6 = 800 tokens. Full 1900 counted: 6100 - 1900 + 800 = 5000.
  const f = groqCacheFinding([call(0, 6100), call(6000, 5000)]);
  assert.equal(f.verdict, 'counted');
});

test('when the two ranges overlap the pair is ambiguous, not evidence either way', () => {
  // cached 200: excluded 1700..2424 overlaps counted 1900..2624.
  const f = groqCacheFinding([call(0, 6100), call(0, 4200, { cached: 200 })]);
  assert.equal(f.pairs, 0);
  assert.equal(f.ambiguous, 1);
  assert.equal(f.verdict, 'no evidence');
});

test('a failed call (even a 200 refusal) moves the baseline, and its pairs are skipped', () => {
  const refusal = call(0, 5000, { status: 'failed', failure: 'refusal' });
  // Against the refusal's header the drop is 620 (excluded). Folding the refusal in would give 1720 (counted).
  const f = groqCacheFinding([call(0, 6100), refusal, call(0, 4380)]);
  assert.equal(f.pairs, 1);
  assert.equal(f.verdict, 'excluded');
});

test('a call with no headers (transport error) resets the baseline', () => {
  const timeout = { status: 'failed', failure: 'timeout', usage: { prompt: 0, cached: 0, completion: 0 }, headers: {} };
  assert.equal(groqCacheFinding([call(0, 6100), timeout, call(0, 5480)]).pairs, 0);
});

test('a pair where remaining tokens went up (bucket refilled) is not evidence', () => {
  assert.equal(groqCacheFinding([call(0, 2000), call(0, 7380)]).pairs, 0);
});

test('calls without cache hits are not evidence', () => {
  const f = groqCacheFinding([call(0, 6100), call(0, 4200, { cached: 0 })]);
  assert.equal(f.pairs, 0);
  assert.equal(f.verdict, 'no evidence');
});
