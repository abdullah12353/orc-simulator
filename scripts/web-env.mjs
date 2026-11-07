// Writes apps/web/.env.local for `npm run dev:web` from the repo's .env.local (`npm run web:env`, #69).
// .env.local is what `neon env pull` writes for a Neon branch: its Neon Auth URL and Data API URL. The
// environment wins over the file, so `NEON_AUTH_URL=… npm run web:env` points the PWA somewhere else.
//
//   VITE_NEON_AUTH_URL      NEON_AUTH_URL, or NEON_AUTH_BASE_URL   (the branch's Neon Auth)
//   VITE_DATA_API_URL       NEON_DATA_API_URL                      (the branch's Data API)
//   VITE_WORKER_URL         WORKER_URL, else wrangler dev's http://127.0.0.1:8787
//   VITE_VAPID_PUBLIC_KEY   VAPID_PUBLIC_KEY, else empty (no push opt-in shown)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../.env.local', import.meta.url);
const saved = existsSync(file)
  ? Object.fromEntries(
      readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/))
        .filter(Boolean)
        .map(([, k, v]) => [k, /^(['"]).*\1$/.test(v) ? v.slice(1, -1) : v]),
    )
  : {};
const pick = (...keys) => keys.map((k) => process.env[k] || saved[k]).find(Boolean) ?? '';

const env = {
  VITE_NEON_AUTH_URL: pick('NEON_AUTH_URL', 'NEON_AUTH_BASE_URL'),
  VITE_DATA_API_URL: pick('NEON_DATA_API_URL'),
  VITE_WORKER_URL: pick('WORKER_URL') || 'http://127.0.0.1:8787',
  VITE_VAPID_PUBLIC_KEY: pick('VAPID_PUBLIC_KEY'),
};
const missing = ['VITE_NEON_AUTH_URL', 'VITE_DATA_API_URL'].filter((k) => !env[k]);
if (missing.length) {
  console.error(`✗ ${missing.join(' and ')}: no NEON_AUTH_URL / NEON_DATA_API_URL in .env.local or the environment.`);
  console.error('  Run `neon env pull` for your Neon branch (it writes .env.local), then this again.');
  process.exit(1);
}
writeFileSync(
  new URL('../apps/web/.env.local', import.meta.url),
  Object.entries(env)
    .map(([k, v]) => `${k}=${v}\n`)
    .join(''),
);
console.log(`wrote apps/web/.env.local (${Object.keys(env).join(', ')})`);
