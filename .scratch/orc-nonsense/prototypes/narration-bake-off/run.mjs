// node run.mjs --mock   -> dry run, no keys, no network
// node run.mjs          -> real run against whichever providers have env keys set
// --limit N             -> only the first N Facts and the first Herald (smoke test)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBakeOff, realProviders, mockProviders } from './bakeoff.mjs';
import { buildSheet } from './sheet.mjs';
import { FACTS } from './fixtures/facts.mjs';
import { HERALDS } from './fixtures/heralds.mjs';

const mock = process.argv.includes('--mock');
const providers = mock ? mockProviders() : realProviders();
if (!providers.length) {
  console.error('No providers configured. Set CF_ACCOUNT_ID + CF_API_TOKEN and/or GROQ_API_KEY, or use --mock.');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const runId = `${mock ? 'mock-' : ''}${stamp}`;
const dir = join(fileURLToPath(new URL('.', import.meta.url)), 'runs', runId);
mkdirSync(dir, { recursive: true });

console.log(`Run ${runId}: ${providers.map((p) => p.model).join(', ')}`);
const li = process.argv.indexOf('--limit');
const limit = li > 0 ? Number(process.argv[li + 1]) : Infinity;
const run = await runBakeOff({
  providers,
  facts: FACTS.slice(0, limit),
  heralds: HERALDS.slice(0, Number.isFinite(limit) ? 1 : undefined),
  onProgress: (r) => console.log(`${r.status === 'ok' ? 'ok  ' : 'FAIL'} ${r.model.padEnd(42)} ${r.inputId.padEnd(18)} ${String(r.latencyMs).padStart(5)}ms ${r.failure ?? ''} ${[...r.flags, ...r.softening].join(',')}`),
});
run.runId = runId;
run.mock = mock;

const { html, key } = buildSheet(run);
writeFileSync(join(dir, 'results.json'), JSON.stringify(run, null, 2));
writeFileSync(join(dir, 'key.json'), JSON.stringify(key, null, 2));
writeFileSync(join(dir, 'sheet.html'), html);

const g = run.groqCache;
console.log(`\nGroq cache finding: ${g.verdict} (${g.pairs} pairs)`);
console.log(`Wrote ${dir}\n  sheet.html   <- open this and rate (don't open key.json)\n  results.json, key.json`);
console.log(`Then: node reveal.mjs runs/${runId} <exported ratings json>`);
