// Unblinds an exported ratings file and prints a per-model summary.
// Usage: node reveal.mjs runs/<runId> path/to/ratings-<runId>.json
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DAILY_FREE_NEURONS } from './neurons.mjs';

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const rate = (n, d) => (d ? n / d : null);
function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };

export function summarize({ run, key, ratings }) {
  if (key.runId !== run.runId || ratings.runId !== run.runId) {
    throw new Error(`ratings/key are for run ${ratings.runId}/${key.runId}, not run ${run.runId}`);
  }
  // Human ratings, unblinded to model.
  const human = {};
  for (const [inputId, byLabel] of Object.entries(ratings.ratings ?? {})) {
    for (const [label, r] of Object.entries(byLabel)) {
      const model = key.labels[inputId]?.[label];
      if (model) (human[model] ||= []).push(r);
    }
  }
  const models = [...new Set(run.results.map((r) => r.model))].map((model) => {
    const rs = run.results.filter((r) => r.model === model);
    const ok = rs.filter((r) => r.status === 'ok');
    const failed = rs.filter((r) => r.status === 'failed');
    const billed = rs.filter((r) => r.usage?.prompt > 0);
    const failureReasons = {};
    for (const r of failed) failureReasons[r.failure] = (failureReasons[r.failure] ?? 0) + 1;
    const hs = (human[model] ?? []).filter((h) => h.funny);
    const swaps = hs.filter((h) => h.swap);
    const clashNeurons = rs.filter((r) => r.kind === 'clash' && r.neurons != null).map((r) => r.neurons);
    const neuronsPerClash = mean(clashNeurons);
    const lat = rs.map((r) => r.latencyMs).filter((x) => x != null);
    return {
      model,
      calls: rs.length,
      failureRate: rate(failed.length, rs.length),
      failureReasons,
      formatPassRate: rate(ok.filter((r) => !r.flags.length).length, rs.length),
      autoSoftenRate: rate(ok.filter((r) => r.softening.length).length, ok.length),
      rated: hs.length,
      meanFunny: mean(hs.map((h) => Number(h.funny))),
      swapPassRate: rate(swaps.filter((h) => h.swap === 'pass').length, swaps.length),
      softenedRate: rate(hs.filter((h) => h.softened && h.softened !== 'no').length, hs.filter((h) => h.softened).length),
      meanPrompt: mean(billed.map((r) => r.usage.prompt)),
      meanCompletion: mean(billed.map((r) => r.usage.completion)),
      meanCached: mean(billed.map((r) => r.usage.cached)),
      meanReasoning: mean(billed.map((r) => r.usage.reasoning)),
      neuronsPerClash,
      clashesPerDay: neuronsPerClash ? DAILY_FREE_NEURONS / neuronsPerClash : null,
      latencyMedianMs: median(lat),
      latencyP95Ms: pct(lat, 0.95),
    };
  });
  return { runId: run.runId, models, groqCache: run.groqCache };
}

const f = (x, d = 0) => (x == null ? '—' : Number(x).toFixed(d));
const p = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

export function formatSummary(s) {
  const rows = [
    ['', ...s.models.map((m) => m.model)],
    ['calls', ...s.models.map((m) => f(m.calls))],
    ['failure rate', ...s.models.map((m) => p(m.failureRate))],
    ['  reasons', ...s.models.map((m) => Object.entries(m.failureReasons).map(([k, v]) => `${k}:${v}`).join(' ') || '—')],
    ['format pass (strict)', ...s.models.map((m) => p(m.formatPassRate))],
    ['auto softening flags', ...s.models.map((m) => p(m.autoSoftenRate))],
    ['rated', ...s.models.map((m) => f(m.rated))],
    ['funny / voice (1-5)', ...s.models.map((m) => f(m.meanFunny, 2))],
    ['swap test pass', ...s.models.map((m) => p(m.swapPassRate))],
    ['softened (human)', ...s.models.map((m) => p(m.softenedRate))],
    ['tokens in / out', ...s.models.map((m) => `${f(m.meanPrompt)} / ${f(m.meanCompletion)}`)],
    ['cached / reasoning', ...s.models.map((m) => `${f(m.meanCached)} / ${f(m.meanReasoning)}`)],
    ['Neurons per Clash', ...s.models.map((m) => f(m.neuronsPerClash, 1))],
    ['Clashes/day in 10k', ...s.models.map((m) => f(m.clashesPerDay))],
    ['latency p50 / p95 ms', ...s.models.map((m) => `${f(m.latencyMedianMs)} / ${f(m.latencyP95Ms)}`)],
  ];
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  const table = rows.map((r) => r.map((c, i) => String(c).padEnd(w[i])).join('  ')).join('\n');
  const g = s.groqCache ?? {};
  const cache = `Groq cache finding: ${g.verdict} (${g.pairs ?? 0} consecutive pairs: ${g.excluded ?? 0} looked excluded, ${g.counted ?? 0} counted; median cached ${g.medianCached ?? 0} tokens).\n` +
    'Note: x-ratelimit-remaining-tokens tracks tokens per MINUTE. The daily cap isn\'t in any header, so for TPD check the Groq console usage page after the run.';
  return `Run ${s.runId}\n\n${table}\n\n${cache}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [runDir, ratingsPath] = process.argv.slice(2);
  if (!runDir || !ratingsPath) {
    console.error('Usage: node reveal.mjs runs/<runId> ratings-<runId>.json');
    process.exit(1);
  }
  const read = (pth) => JSON.parse(readFileSync(pth, 'utf8'));
  const s = summarize({ run: read(join(runDir, 'results.json')), key: read(join(runDir, 'key.json')), ratings: read(ratingsPath) });
  console.log(formatSummary(s));
}
