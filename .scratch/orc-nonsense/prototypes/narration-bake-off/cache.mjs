// Do Groq's cached prefix tokens really stay out of the token limit?
// Compare how far x-ratelimit-remaining-tokens falls between consecutive calls with the call's
// full vs uncached token count, after crediting back the per-minute refill for the gap.
// Groq's docs say this header tracks tokens per MINUTE; the daily (TPD) budget isn't in any header,
// so this is evidence for TPM and only by inference for TPD.

const num = (v) => (v == null || v === '' ? null : Number(v));

export function groqCacheFinding(calls) {
  const evidence = [];
  let prev = null;
  for (const c of calls) {
    const remaining = num(c.headers?.['x-ratelimit-remaining-tokens']);
    if (!c.ok || remaining == null) continue;
    if (prev && c.usage.cached > 0) {
      const limit = num(c.headers['x-ratelimit-limit-tokens']) ?? 0;
      const gapMs = Math.max(0, (c.startedAt ?? 0) - (prev.startedAt ?? 0));
      const refill = (limit / 60_000) * gapMs;
      const drop = prev.remaining - remaining + refill;
      const full = c.usage.prompt + c.usage.completion;
      const uncached = full - c.usage.cached;
      // A bucket refilled to the brim can't show the cost.
      if (remaining < limit && remaining <= prev.remaining) {
        evidence.push({ drop: Math.round(drop), full, uncached, cached: c.usage.cached,
          verdict: Math.abs(drop - uncached) < Math.abs(drop - full) ? 'excluded' : 'counted' });
      }
    }
    prev = { remaining, startedAt: c.startedAt };
  }
  const excluded = evidence.filter((e) => e.verdict === 'excluded').length;
  const counted = evidence.length - excluded;
  const cachedSorted = evidence.map((e) => e.cached).sort((a, b) => a - b);
  return {
    pairs: evidence.length,
    excluded,
    counted,
    medianCached: cachedSorted.length ? cachedSorted[Math.floor(cachedSorted.length / 2)] : 0,
    verdict: !evidence.length ? 'no evidence' : excluded > counted ? 'excluded' : excluded < counted ? 'counted' : 'mixed',
    evidence,
  };
}
