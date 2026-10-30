// Writes apps/web/.env.local from the running local Supabase stack (`npm run web:env`).
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const status = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8' }));
// Pushes (#42): the PWA needs the VAPID public key the tick signs with. Empty (no push opt-in shown) unless
// VAPID_PUBLIC_KEY is in the environment.
const env =
  `VITE_SUPABASE_URL=${status.API_URL}\nVITE_SUPABASE_ANON_KEY=${status.ANON_KEY}\n` +
  `VITE_VAPID_PUBLIC_KEY=${process.env.VAPID_PUBLIC_KEY ?? ''}\n`;
writeFileSync(new URL('../apps/web/.env.local', import.meta.url), env);
console.log('wrote apps/web/.env.local');
