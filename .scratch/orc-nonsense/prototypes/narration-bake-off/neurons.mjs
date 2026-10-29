// Neurons per 1M tokens. The research doc (free-llm-api-options §1.4) gives only per-Clash and
// per-Herald totals; these rates are solved back from its two columns (1.5k/200 and 3k/600).
// Llama's match Cloudflare's published 26,668 / 204,805. Gemma's are derived, so treat them as an estimate.
// Reasoning tokens are assumed to bill as output (the doc marks this UNCERTAIN).
export const NEURON_RATES = {
  '@cf/google/gemma-4-26b-a4b-it': { in: 8_667, out: 30_000 },
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { in: 26_668, out: 204_805 },
};

export const DAILY_FREE_NEURONS = 10_000;

export function estimateNeurons(model, { prompt = 0, completion = 0 } = {}) {
  const r = NEURON_RATES[model];
  if (!r) return null;
  return (prompt * r.in + completion * r.out) / 1e6;
}
