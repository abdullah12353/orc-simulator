// Reads and updates the dotenv files the deploy scripts share: `.env.deploy` (git-ignored, the single source
// `provision.mjs` reads, #62 item 4), `.env.local` and `apps/worker/.dev.vars`. Lines it doesn't own are kept
// as they are, so a hand-written comment or an extra key survives every run.
//
// Values are written the way the deploy wizard writes them: KEY='value', with a ' inside as '\''. Reading
// also takes plain KEY=value and KEY="value" (what `neon env pull` writes).
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

/** One value as written in the file → the value itself. */
function decode(raw) {
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replaceAll("'\\''", "'");
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  return raw;
}

/** The file's KEY → value map, or {} when there's no file. A later line wins, as in a shell. */
export function readEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (m) out[m[1]] = decode(m[2]);
  }
  return out;
}

/**
 * Sets `updates` (KEY → value; null deletes the key) in the file, keeping every other line, and returns
 * the keys whose value changed. Writes nothing when nothing changed. `quote: false` writes KEY=value
 * (for .dev.vars and .env.local, whose values never need quoting).
 */
export function updateEnv(path, updates, { quote = true } = {}) {
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : [];
  if (lines.at(-1) === '') lines.pop();
  const current = readEnv(path);
  const changed = Object.entries(updates)
    .filter(([k, v]) => (v === null ? k in current : current[k] !== v))
    .map(([k]) => k);
  if (changed.length === 0) return [];

  const render = (k, v) => {
    if (quote) return `${k}='${v.replaceAll("'", "'\\''")}'`;
    if (/[\s'"#]/.test(v)) throw new Error(`${k}'s value can't be written unquoted`);
    return `${k}=${v}`;
  };
  const kept = [];
  const placed = new Set();
  for (const line of lines) {
    const key = LINE.exec(line)?.[1];
    if (key === undefined || !changed.includes(key)) {
      kept.push(line);
    } else if (updates[key] !== null && !placed.has(key)) {
      kept.push(render(key, updates[key]));
      placed.add(key);
    }
  }
  for (const k of changed) if (updates[k] !== null && !placed.has(k)) kept.push(render(k, updates[k]));
  const isNew = !existsSync(path);
  writeFileSync(path, `${kept.join('\n')}\n`, { mode: 0o600 });
  if (isNew) chmodSync(path, 0o600);
  return changed;
}
