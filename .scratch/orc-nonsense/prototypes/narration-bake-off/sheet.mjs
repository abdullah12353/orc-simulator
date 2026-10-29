// Builds the blind rating sheet (self-contained HTML) and the separate key that unblinds it.
import { createHash } from 'node:crypto';
import { CAST } from './fixtures/cast.mjs';
import { loadToneBible, parseCalibrationSamples } from './prompt.mjs';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const name = (id) => CAST[id]?.name ?? id;

function seededShuffle(arr, seed) {
  const h = createHash('sha256').update(seed).digest();
  let s = h.readUInt32LE(0);
  const rand = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32; };
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function factHtml(f) {
  const rows = [
    ['Clash', `${esc(name(f.a))} vs ${esc(name(f.b))}`],
    ['Why', esc(f.why)],
    ['Outcome', `${esc(name(f.winner))} wins; <b>${esc(f.result)}</b>: ${esc(name(f.loser))} (loser speaks last)`],
    f.saviour && ['Wrong saviour', esc(name(f.saviour))],
    f.aftermath && ['Aftermath', esc(f.aftermath)],
    f.trophy && ['Trophy', `${esc(f.trophy.item)}: ${esc(name(f.trophy.from))} → ${esc(name(f.trophy.to))}`],
    f.grudges?.length && ['Grudges', f.grudges.map(esc).join('<br>')],
    f.rumourLine && ['Player line', `“${esc(f.rumourLine)}”`],
    f.invites?.length && ['Invites', esc(f.invites.join(', '))],
  ].filter(Boolean);
  return `<table class="fact">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`;
}

function outputHtml(r) {
  if (!r || r.status === 'failed') return '<div class="failed">FAILED (template would be used)</div>';
  if (r.kind === 'herald') return `<div class="herald"><div class="hl">${esc(r.headline)}</div><p>${esc(r.body)}</p></div>`;
  return `<ol class="lines">${r.lines.map((l) => `<li><b>${esc(name(l.speaker))}:</b> ${esc(l.text)}</li>`).join('')}</ol>`;
}

function ratingHtml(inputId, label, kind) {
  const k = `${inputId}|${label}`;
  const opt = (field, vals) => `<select data-k="${esc(k)}" data-f="${field}"><option value="">${field}…</option>${vals.map((v) => `<option>${v}</option>`).join('')}</select>`;
  return `<div class="rate">
    ${opt('funny', ['1', '2', '3', '4', '5'])}
    ${kind === 'clash' ? opt('swap', ['pass', 'fail']) : ''}
    ${opt('softened', ['no', 'a bit', 'yes'])}
    <input data-k="${esc(k)}" data-f="note" placeholder="note">
  </div>`;
}

export function buildSheet(run, { seed = run.runId ?? 'seed' } = {}) {
  const models = [...new Set(run.results.map((r) => r.model))];
  const LABELS = 'ABCDEFG'.slice(0, models.length).split('');
  const key = { runId: run.runId, labels: {} };
  const sections = run.inputs.map((input) => {
    const order = seededShuffle(models, `${seed}|${input.id}`);
    key.labels[input.id] = Object.fromEntries(LABELS.map((l, i) => [l, order[i]]));
    const cols = LABELS.map((l, i) => {
      const r = run.results.find((x) => x.inputId === input.id && x.model === order[i]);
      return `<div class="col"><h3>${l}</h3>${outputHtml(r)}${ratingHtml(input.id, l, input.kind)}</div>`;
    }).join('');
    const brief = input.kind === 'clash' ? factHtml(input.fact) : `<ul>${input.herald.events.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
    return `<section id="${esc(input.id)}"><h2>${esc(input.id)} <small>${input.kind}</small></h2>${brief}<div class="cols">${cols}</div></section>`;
  }).join('\n');

  const samples = parseCalibrationSamples(loadToneBible())
    .map((g) => `<h4>${esc(g.who)}</h4><ul>${g.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`).join('');

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Narration bake-off: blind rating ${esc(run.runId)}</title>
<style>
body{font:15px/1.4 system-ui,sans-serif;margin:0 auto;max-width:1300px;padding:1em;background:#f6f3ec;color:#222}
header{position:sticky;top:0;background:#222;color:#fff;padding:.6em 1em;display:flex;gap:1em;align-items:center;z-index:1}
section{background:#fff;margin:1.2em 0;padding:1em;border-radius:6px;box-shadow:0 1px 3px #0002}
.fact th{text-align:left;vertical-align:top;padding-right:1em;color:#666;font-weight:600}
.cols{display:grid;grid-template-columns:repeat(${LABELS.length},1fr);gap:1em;margin-top:1em}
.col{border:1px solid #ddd;border-radius:4px;padding:.6em}.col h3{margin:0 0 .4em}
.failed{color:#a00;font-weight:700;padding:1em 0}.hl{font:900 1.2em Georgia,serif;text-transform:uppercase}
.rate{display:flex;flex-wrap:wrap;gap:.3em;margin-top:.6em;border-top:1px dashed #ccc;padding-top:.5em}.rate input{flex:1;min-width:8em}
details{background:#fff;padding:.6em 1em;border-radius:6px}
</style></head><body>
<header><b>Blind rating</b><span id="progress"></span><button id="export">Export ratings JSON</button><small>Saved in this browser as you go. Run: ${esc(run.runId)}</small></header>
<p>Rate each column on its own. <b>funny</b> 1–5 = funniness and voice against the tone bible. <b>swap</b> = does it pass the swap test (accent is voice, never punchline)? <b>softened</b> = did it sanitise, lecture or dodge where the Fact invited heat? FAILED columns don't need rating.</p>
<details><summary>Tone bible §6 calibration samples (approved heat)</summary>${samples}</details>
${sections}
<script>
const RUN_ID = ${JSON.stringify(run.runId)};
const STORE = 'bakeoff-ratings-' + RUN_ID;
const state = JSON.parse(localStorage.getItem(STORE) || '{}');
const fields = document.querySelectorAll('[data-k]');
function progress() {
  const keys = new Set([...fields].map((el) => el.dataset.k));
  const done = [...keys].filter((k) => state[k] && state[k].funny).length;
  document.getElementById('progress').textContent = done + ' / ' + keys.size + ' rated';
}
for (const el of fields) {
  const v = state[el.dataset.k] && state[el.dataset.k][el.dataset.f];
  if (v != null) el.value = v;
  el.addEventListener('change', () => {
    (state[el.dataset.k] ||= {})[el.dataset.f] = el.value;
    localStorage.setItem(STORE, JSON.stringify(state));
    progress();
  });
}
progress();
document.getElementById('export').onclick = () => {
  const ratings = {};
  for (const [k, v] of Object.entries(state)) { const [id, label] = k.split('|'); (ratings[id] ||= {})[label] = v; }
  const blob = new Blob([JSON.stringify({ runId: RUN_ID, exportedAt: new Date().toISOString(), ratings }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ratings-' + RUN_ID + '.json';
  a.click();
};
</script></body></html>`;
  return { html, key };
}
