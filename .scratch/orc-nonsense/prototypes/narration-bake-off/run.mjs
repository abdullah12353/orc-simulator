// node run.mjs --mock   -> dry run, no keys, no network
// node run.mjs          -> real run against whichever providers have env keys set
// --limit N             -> only the first N Facts, N calibration voices and the first Herald (smoke test)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBakeOff, realProviders, mockProviders } from './bakeoff.mjs';
import { buildSheet } from './sheet.mjs';
import { parseArgs } from './cli.mjs';
import { calibrationInputs, loadToneBible, parseCalibrationSamples } from './prompt.mjs';
import { CAST } from './fixtures/cast.mjs';
import { FACTS } from './fixtures/facts.mjs';
import { HERALDS } from './fixtures/heralds.mjs';

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const providers = args.mock ? mockProviders() : realProviders();
if (!providers.length) {
  console.error('No providers configured. Set CF_ACCOUNT_ID + CF_API_TOKEN and/or GROQ_API_KEY, or use --mock.');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const runId = `${args.mock ? 'mock-' : ''}${stamp}`;
const dir = join(fileURLToPath(new URL('.', import.meta.url)), 'runs', runId);
mkdirSync(dir, { recursive: true });

const limit = args.limit ?? Infinity;
const calibrations = calibrationInputs(parseCalibrationSamples(loadToneBible()), CAST);
console.log(`Run ${runId}: ${providers.map((p) => p.model).join(', ')}`);
const run = await runBakeOff({
  providers,
  facts: FACTS.slice(0, limit),
  calibrations: calibrations.slice(0, limit),
  heralds: HERALDS.slice(0, args.limit ? 1 : undefined),
  // The mock has no clock, so it skips Groq pacing waits; real runs wait.
  ...(args.mock ? { sleep: async () => {} } : {}),
  onProgress: (r) => console.log(`${r.status === 'ok' ? 'ok  ' : 'FAIL'} ${r.model.padEnd(42)} ${r.inputId.padEnd(18)} ${String(r.latencyMs).padStart(5)}ms ${r.failure ?? ''} ${[...r.flags, ...r.softening].join(',')}`),
});
run.runId = runId;
run.mock = args.mock;

const { html, key } = buildSheet(run);
writeFileSync(join(dir, 'results.json'), JSON.stringify(run, null, 2));
writeFileSync(join(dir, 'key.json'), JSON.stringify(key, null, 2));
writeFileSync(join(dir, 'sheet.html'), html);

const cache = run.groqCache;
console.log(`\nGroq cache finding (per-minute limit): ${cache.verdict} (${cache.pairs} pairs, ${cache.ambiguous} ambiguous)`);
console.log(`Wrote ${dir}\n  sheet.html   <- open this and rate (don't open key.json)\n  results.json, key.json`);
console.log(`Then: node reveal.mjs runs/${runId} <exported ratings json>`);
