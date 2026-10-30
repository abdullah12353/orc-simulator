// Rebuilds the PWA and redeploys it to Cloudflare Pages with the values the deploy wizard saved in
// .env.deploy (`npm run deploy:web`). Use it after new audio or art lands in apps/web/public.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const file = new URL('../.env.deploy', import.meta.url);
if (!existsSync(file)) {
  console.error('✗ No .env.deploy. Run the deploy wizard first (scripts/setup-deploy.sh).');
  process.exit(1);
}
// The wizard writes KEY='value', with a ' inside written as '\''.
const saved = Object.fromEntries(
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/))
    .filter(Boolean)
    .map(([, k, v]) => [k, v.startsWith("'") && v.endsWith("'") ? v.slice(1, -1).replaceAll("'\\''", "'") : v]),
);
for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'VAPID_PUBLIC_KEY', 'PAGES_PROJECT']) {
  if (!saved[k]) {
    console.error(`✗ .env.deploy has no ${k}. Run the deploy wizard's stage 10 first.`);
    process.exit(1);
  }
}
const env = {
  ...process.env,
  VITE_SUPABASE_URL: saved.SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: saved.SUPABASE_ANON_KEY,
  VITE_VAPID_PUBLIC_KEY: saved.VAPID_PUBLIC_KEY,
};
execSync('npm run build:web', { stdio: 'inherit', env });
execSync(`npx wrangler pages deploy apps/web/dist --project-name "${saved.PAGES_PROJECT}" --branch main`, { stdio: 'inherit', env });
