// Shared by cache.mjs and reveal.mjs.

// rate_limited and transport say nothing about the model, so reveal keeps them out of its quality rates.
export function failureCategory(failure) {
  if (!failure) return 'none';
  if (failure === 'refusal') return 'refusal';
  if (failure === 'http_429') return 'rate_limited';
  if (failure === 'timeout' || failure === 'network' || /^http_\d+$/.test(failure)) return 'transport';
  return 'format';
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
