// Unblinds an exported ratings file and prints a per-model summary.
// Usage: node reveal.mjs runs/<runId> path/to/ratings-<runId>.json
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DAILY_FREE_NEURONS } from './neurons.mjs';
import { failureCategory, median } from './failures.mjs';

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const ratio = (n, d) => (d ? n / d : null);
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

export function summarize({ run, key, ratings }) {
  if (key.runId !== run.runId || ratings.runId !== run.runId) {
    throw new Error(`ratings/key are for run ${ratings.runId}/${key.runId}, not run ${run.runId}`);
  }
  // Human ratings, unblinded to model.
  const human = {};
  for (const [inputId, byLabel] of Object.entries(ratings.ratings ?? {})) {
    for (const [label, rating] of Object.entries(byLabel)) {
      const model = key.labels[inputId]?.[label];
      if (model) (human[model] ||= []).push(rating);
    }
  }
  const models = [...new Set(run.results.map((r) => r.model))].map((model) => {
    const all = run.results.filter((r) => r.model === model);
    const category = (r) => failureCategory(r.failure);
    // Rate limits and transport errors say nothing about the model: keep them out of the quality rates.
    const scored = all.filter((r) => !['rate_limited', 'transport'].includes(category(r)));
    const ok = scored.filter((r) => r.status === 'ok');
    const failureReasons = {};
    for (const r of all.filter((x) => x.status === 'failed')) failureReasons[r.failure] = (failureReasons[r.failure] ?? 0) + 1;
    const billed = all.filter((r) => r.usage?.prompt > 0);
    const rated = (human[model] ?? []).filter((h) => h.funny);
    const swapRated = rated.filter((h) => h.swap);
    const neuronsPerClash = mean(all.filter((r) => r.kind === 'clash' && r.neurons != null).map((r) => r.neurons));
    const latencies = all.map((r) => r.latencyMs).filter((x) => x != null);
    return {
      model,
      calls: all.length,
      scored: scored.length,
      rateLimited: all.filter((r) => category(r) === 'rate_limited').length,
      transport: all.filter((r) => category(r) === 'transport').length,
      failureRate: ratio(scored.length - ok.length, scored.length),
      refusalRate: ratio(scored.filter((r) => category(r) === 'refusal').length, scored.length),
      failureReasons,
      formatPassRate: ratio(ok.filter((r) => !r.flags.length).length, scored.length),
      autoSoftenRate: ratio(ok.filter((r) => r.softening.length).length, ok.length),
      rated: rated.length,
      meanFunny: mean(rated.map((h) => Number(h.funny))),
      swapPassRate: ratio(swapRated.filter((h) => h.swap === 'pass').length, swapRated.length),
      softenedRate: ratio(rated.filter((h) => h.softened && h.softened !== 'no').length, rated.filter((h) => h.softened).length),
      meanPrompt: mean(billed.map((r) => r.usage.prompt)),
      meanCompletion: mean(billed.map((r) => r.usage.completion)),
      meanCached: mean(billed.map((r) => r.usage.cached)),
      meanReasoning: mean(billed.map((r) => r.usage.reasoning)),
      neuronsPerClash,
      clashesPerDay: neuronsPerClash ? DAILY_FREE_NEURONS / neuronsPerClash : null,
      latencyMedianMs: median(latencies),
      latencyP95Ms: percentile(latencies, 0.95),
    };
  });
  return { runId: run.runId, models, groqCache: run.groqCache };
}

const fmtNum = (x, digits = 0) => (x == null ? '—' : Number(x).toFixed(digits));
const fmtPct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

export function formatSummary(summary) {
  const ms = summary.models;
  const rows = [
    ['', ...ms.map((m) => m.model)],
    ['calls (scored)', ...ms.map((m) => `${m.calls} (${m.scored})`)],
    ['rate-limited / transport', ...ms.map((m) => `${m.rateLimited} / ${m.transport}`)],
    ['failure rate', ...ms.map((m) => fmtPct(m.failureRate))],
    ['refusal rate', ...ms.map((m) => fmtPct(m.refusalRate))],
    ['  reasons', ...ms.map((m) => Object.entries(m.failureReasons).map(([k, v]) => `${k}:${v}`).join(' ') || '—')],
    ['format pass (strict)', ...ms.map((m) => fmtPct(m.formatPassRate))],
    ['auto softening flags', ...ms.map((m) => fmtPct(m.autoSoftenRate))],
    ['rated', ...ms.map((m) => fmtNum(m.rated))],
    ['funny / voice (1-5)', ...ms.map((m) => fmtNum(m.meanFunny, 2))],
    ['swap test pass', ...ms.map((m) => fmtPct(m.swapPassRate))],
    ['softened (human)', ...ms.map((m) => fmtPct(m.softenedRate))],
    ['tokens in / out', ...ms.map((m) => `${fmtNum(m.meanPrompt)} / ${fmtNum(m.meanCompletion)}`)],
    ['cached / reasoning', ...ms.map((m) => `${fmtNum(m.meanCached)} / ${fmtNum(m.meanReasoning)}`)],
    ['Neurons per Clash (est.)', ...ms.map((m) => fmtNum(m.neuronsPerClash, 1))],
    ['Clashes/day in 10k (est.)', ...ms.map((m) => fmtNum(m.clashesPerDay))],
    ['latency p50 / p95 ms', ...ms.map((m) => `${fmtNum(m.latencyMedianMs)} / ${fmtNum(m.latencyP95Ms)}`)],
  ];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => String(row[i]).length)));
  const table = rows.map((row) => row.map((cell, i) => String(cell).padEnd(widths[i])).join('  ')).join('\n');
  const cache = summary.groqCache ?? {};
  const cacheText = `Groq cache finding (per-minute limit): ${cache.verdict} (${cache.pairs ?? 0} consecutive pairs: ${cache.excluded ?? 0} looked excluded, ${cache.counted ?? 0} counted, ${cache.ambiguous ?? 0} ambiguous; median cached ${cache.medianCached ?? 0} tokens).\n` +
    'The header only covers tokens per MINUTE. For the daily cap, compare the Groq console\'s daily usage with the token totals in results.json.\n' +
    'Neurons are estimates; the real figure is the Cloudflare dashboard\'s Workers AI usage after the run.';
  return `Run ${summary.runId}\n\n${table}\n\n${cacheText}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [runDir, ratingsPath] = process.argv.slice(2);
  if (!runDir || !ratingsPath) {
    console.error('Usage: node reveal.mjs runs/<runId> ratings-<runId>.json');
    process.exit(1);
  }
  const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
  const summary = summarize({ run: readJson(join(runDir, 'results.json')), key: readJson(join(runDir, 'key.json')), ratings: readJson(ratingsPath) });
  console.log(formatSummary(summary));
}
