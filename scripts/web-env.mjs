// Writes apps/web/.env.local from the running local Supabase stack (`npm run web:env`).
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const status = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8' }));
const env = `VITE_SUPABASE_URL=${status.API_URL}\nVITE_SUPABASE_ANON_KEY=${status.ANON_KEY}\n`;
writeFileSync(new URL('../apps/web/.env.local', import.meta.url), env);
console.log('wrote apps/web/.env.local');
