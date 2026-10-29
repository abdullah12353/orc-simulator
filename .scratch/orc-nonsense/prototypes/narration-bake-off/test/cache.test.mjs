import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groqCacheFinding } from '../cache.mjs';

const call = (startedAt, remaining, { prompt = 1600, cached = 1280, completion = 300 } = {}) => ({
  ok: true, startedAt, usage: { prompt, cached, completion, reasoning: 0 },
  headers: { 'x-ratelimit-remaining-tokens': String(remaining), 'x-ratelimit-limit-tokens': '8000' },
});

test('a header drop matching only the uncached tokens says cached tokens are excluded', () => {
  // 1600 + 300 = 1900 total, 620 of it uncached.
  const f = groqCacheFinding([call(0, 6100), call(0, 5480), call(0, 4860)]);
  assert.equal(f.pairs, 2);
  assert.equal(f.excluded, 2);
  assert.equal(f.counted, 0);
  assert.equal(f.verdict, 'excluded');
});

test('a header drop matching the full token count says cached tokens are counted', () => {
  const f = groqCacheFinding([call(0, 6100), call(0, 4200)]);
  assert.equal(f.counted, 1);
  assert.equal(f.verdict, 'counted');
});

test('TPM refill between calls is credited back before judging', () => {
  // 6 s gap refills 8000/60*6 = 800 tokens. Full 1900 counted: 6100 - 1900 + 800 = 5000.
  const f = groqCacheFinding([call(0, 6100), call(6000, 5000)]);
  assert.equal(f.verdict, 'counted');
});

test('a pair where remaining tokens went up (bucket refilled) is not evidence', () => {
  const f = groqCacheFinding([call(0, 2000), call(0, 7380)]);
  assert.equal(f.pairs, 0);
});

test('calls without cache hits, failed calls or missing headers are not evidence', () => {
  const noCache = call(0, 4200, { cached: 0 });
  const failed = { ...call(0, 3000), ok: false };
  const noHeaders = { ...call(0, 0), headers: {} };
  const f = groqCacheFinding([call(0, 6100), noCache, failed, noHeaders]);
  assert.equal(f.pairs, 0);
  assert.equal(f.verdict, 'no evidence');
});
