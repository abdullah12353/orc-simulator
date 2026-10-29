import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateNeurons } from '../neurons.mjs';

// Expected figures are the research doc's table (free-llm-api-options §1.4), 1.5k in / 200 out and 3k / 600.
test('Neurons per Clash and per Herald match the research doc table', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) <= 1, `${a} vs ${b}`);
  near(estimateNeurons('@cf/google/gemma-4-26b-a4b-it', { prompt: 1500, completion: 200 }), 19);
  near(estimateNeurons('@cf/google/gemma-4-26b-a4b-it', { prompt: 3000, completion: 600 }), 44);
  near(estimateNeurons('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { prompt: 1500, completion: 200 }), 81);
  near(estimateNeurons('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { prompt: 3000, completion: 600 }), 203);
});

test('models outside Workers AI cost no Neurons', () => {
  assert.equal(estimateNeurons('openai/gpt-oss-120b', { prompt: 1500, completion: 200 }), null);
});
