import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSheet } from '../sheet.mjs';
import { runBakeOff, mockProviders } from '../bakeoff.mjs';

const run = await runBakeOff({ providers: mockProviders({ timeoutMs: 50 }) });
run.runId = 'test-run';
const { html, key } = buildSheet(run, { seed: 'abc' });

test('the sheet is blind: no model or provider names anywhere in it', () => {
  for (const word of ['gemma', 'llama', 'gpt-oss', 'groq', 'workers', '@cf/', 'openai', 'neuron']) {
    assert.ok(!html.toLowerCase().includes(word), `sheet leaks "${word}"`);
  }
});

test('the key maps every input\'s labels onto all three models, in shuffled orders', () => {
  assert.equal(key.runId, 'test-run');
  assert.equal(Object.keys(key.labels).length, run.inputs.length);
  const orders = new Set();
  for (const [id, map] of Object.entries(key.labels)) {
    assert.deepEqual(Object.keys(map).sort(), ['A', 'B', 'C'], id);
    assert.equal(new Set(Object.values(map)).size, 3, id);
    orders.add(JSON.stringify(map));
  }
  assert.ok(orders.size > 2, 'labels are not shuffled');
});

test('the same seed gives the same key', () => {
  assert.deepEqual(buildSheet(run, { seed: 'abc' }).key, key);
});

test('outputs are shown escaped, and failures say FAILED without the reason', () => {
  const okLine = run.results.find((r) => r.status === 'ok' && r.kind === 'clash').lines[0].text;
  const escaped = okLine.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
  assert.ok(html.includes(escaped) || html.includes(JSON.stringify(okLine).slice(1, -1)), 'ok output missing');
  assert.ok(html.includes('FAILED'));
  assert.ok(!html.includes('loser_not_last'));
});

test('the sheet saves to localStorage and exports JSON', () => {
  assert.match(html, /localStorage/);
  assert.match(html, /application\/json/);
  assert.match(html, /test-run/);
});
