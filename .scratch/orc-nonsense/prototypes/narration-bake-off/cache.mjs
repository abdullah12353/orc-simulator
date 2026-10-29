// Do Groq's cached prefix tokens really stay out of the token limit?
//
// For each pair of consecutive calls, take how far x-ratelimit-remaining-tokens fell (crediting
// back the per-minute refill for the gap) and compare it with two RANGES:
//   excluded: (prompt - cached) + completion  ..  (prompt - cached) + max_completion_tokens
//   counted:   prompt           + completion  ..   prompt           + max_completion_tokens
// The upper ends cover Groq reserving max_completion_tokens when it accepts a request.
// usage.completion INCLUDES reasoning tokens (OpenAI/Groq convention; mock.mjs reports it the same way).
// If the two ranges overlap, the pair is ambiguous and isn't counted either way.
//
// Groq's docs say this header tracks tokens per MINUTE. The daily (TPD) budget isn't in any header,
// so the daily question is answered by the Groq console's usage page, not by this.
import { failureCategory, median } from './failures.mjs';

const num = (v) => (v == null || v === '' ? null : Number(v));
const distance = (x, [lo, hi]) => (x < lo ? lo - x : x > hi ? x - hi : 0);

export function groqCacheFinding(calls) {
  const evidence = [];
  let ambiguous = 0;
  let prev = null;
  for (const c of calls) {
    const remaining = num(c.headers?.['x-ratelimit-remaining-tokens']);
    if (remaining == null) {
      // Transport error: the bucket's state afterwards is unknown.
      prev = null;
      continue;
    }
    const usable = failureCategory(c.failure) === 'none' && c.usage.cached > 0;
    const limit = num(c.headers['x-ratelimit-limit-tokens']) ?? 0;
    // A bucket refilled to the brim (or refilled past the last reading) can't show the cost.
    if (prev && usable && remaining < limit && remaining <= prev.remaining) {
      const gapMs = Math.max(0, (c.startedAt ?? 0) - (prev.startedAt ?? 0));
      const drop = prev.remaining - remaining + (limit / 60_000) * gapMs;
      const { prompt, cached, completion } = c.usage;
      const reserved = Math.max(completion, c.maxCompletionTokens ?? completion);
      const excludedRange = [prompt - cached + completion, prompt - cached + reserved];
      const countedRange = [prompt + completion, prompt + reserved];
      if (excludedRange[1] >= countedRange[0]) {
        ambiguous++;
      } else {
        evidence.push({ drop: Math.round(drop), excludedRange, countedRange, cached,
          verdict: distance(drop, excludedRange) < distance(drop, countedRange) ? 'excluded' : 'counted' });
      }
    }
    // Every call with a header moves the baseline, failed or not, so no cost is folded into the next pair.
    prev = { remaining, startedAt: c.startedAt };
  }
  const excluded = evidence.filter((e) => e.verdict === 'excluded').length;
  const counted = evidence.length - excluded;
  return {
    pairs: evidence.length,
    excluded,
    counted,
    ambiguous,
    medianCached: median(evidence.map((e) => e.cached)) ?? 0,
    verdict: !evidence.length ? 'no evidence' : excluded > counted ? 'excluded' : excluded < counted ? 'counted' : 'mixed',
    evidence,
  };
}
