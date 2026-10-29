import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, formatSummary } from '../reveal.mjs';

const rec = (inputId, kind, model, o) => ({ inputId, kind, model, flags: [], softening: [], usage: { prompt: 0, completion: 0, cached: 0, reasoning: 0 }, neurons: null, ...o });
const run = {
  runId: 'r1',
  inputs: [{ id: 'c1', kind: 'clash' }, { id: 'h1', kind: 'herald' }],
  results: [
    rec('c1', 'clash', 'X', { status: 'ok', latencyMs: 100, usage: { prompt: 1000, completion: 100, cached: 0, reasoning: 0 }, neurons: 10 }),
    rec('h1', 'herald', 'X', { status: 'failed', failure: 'refusal', latencyMs: 300, usage: { prompt: 2000, completion: 20, cached: 0, reasoning: 0 }, neurons: 18 }),
    rec('c1', 'clash', 'Y', { status: 'ok', latencyMs: 200, flags: ['fenced_json'], softening: ['minced_oath'], usage: { prompt: 1000, completion: 300, cached: 800, reasoning: 50 } }),
    rec('h1', 'herald', 'Y', { status: 'ok', latencyMs: 400, usage: { prompt: 2000, completion: 500, cached: 800, reasoning: 50 } }),
  ],
  groqCache: { verdict: 'excluded', pairs: 3, excluded: 3, counted: 0, medianCached: 800 },
};
const key = { runId: 'r1', labels: { c1: { A: 'X', B: 'Y' }, h1: { A: 'Y', B: 'X' } } };
const ratings = { runId: 'r1', ratings: {
  c1: { A: { funny: '4', swap: 'pass', softened: 'no' }, B: { funny: '2', swap: 'fail', softened: 'yes' } },
  h1: { A: { funny: '3', softened: 'no' } },
} };

test('unblinding combines human ratings with the automatic metrics per model', () => {
  const s = summarize({ run, key, ratings });
  const X = s.models.find((m) => m.model === 'X');
  const Y = s.models.find((m) => m.model === 'Y');
  assert.equal(X.calls, 2);
  assert.equal(X.failureRate, 0.5);
  assert.deepEqual(X.failureReasons, { refusal: 1 });
  assert.equal(X.formatPassRate, 0.5);
  assert.equal(X.meanFunny, 4);
  assert.equal(X.swapPassRate, 1);
  assert.equal(X.softenedRate, 0);
  assert.equal(X.neuronsPerClash, 10);
  assert.equal(X.clashesPerDay, 1000);
  assert.equal(X.latencyMedianMs, 200);

  assert.equal(Y.failureRate, 0);
  assert.equal(Y.formatPassRate, 0.5);
  assert.equal(Y.autoSoftenRate, 0.5);
  assert.equal(Y.meanFunny, 2.5);
  assert.equal(Y.swapPassRate, 0);
  assert.equal(Y.softenedRate, 0.5);
  assert.equal(Y.meanCached, 800);
  assert.equal(Y.neuronsPerClash, null);
  assert.equal(Y.rated, 2);
});

test('calls that never returned usage (timeouts) do not drag the token means down', () => {
  const withTimeout = { ...run, results: [...run.results, rec('c2', 'clash', 'X', { status: 'failed', failure: 'timeout', latencyMs: 30000 })] };
  const X = summarize({ run: withTimeout, key, ratings }).models.find((m) => m.model === 'X');
  assert.equal(X.meanPrompt, 1500);
  assert.equal(X.failureRate, 2 / 3);
});

test('ratings from a different run are rejected', () => {
  assert.throws(() => summarize({ run, key, ratings: { ...ratings, runId: 'other' } }), /run/);
});

test('the printed summary names each model and the Groq cache finding', () => {
  const out = formatSummary(summarize({ run, key, ratings }));
  assert.match(out, /X/);
  assert.match(out, /Y/);
  assert.match(out, /excluded/);
});
