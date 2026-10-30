// Stands in for apps/web/src/supabase.ts in Seam B (see redirect-supabase.mjs): the same supabase-js
// client the PWA uses, talking to the local stack's PostgREST as a signed-in user, so RLS applies.
import { createHmac } from 'node:crypto';
import { execSync } from 'node:child_process';
import { register } from 'node:module';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** The client the PWA's modules import. Reassigned by `signInAs` (ESM exports are live bindings). */
export let supabase: SupabaseClient;

let stack: { API_URL: string; ANON_KEY: string; JWT_SECRET: string } | undefined;

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/** A user JWT signed like GoTrue's (HS256, the local stack's secret). */
function userJwt(userId: string, secret: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const claims = b64url(JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600 }));
  const sig = createHmac('sha256', secret).update(`${header}.${claims}`).digest('base64url');
  return `${header}.${claims}.${sig}`;
}

/** Points the PWA's client at the local stack, signed in as this user. */
export function signInAs(userId: string): void {
  stack ??= JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  const { API_URL, ANON_KEY, JWT_SECRET } = stack!;
  supabase = createClient(API_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${userJwt(userId, JWT_SECRET)}` } },
  });
}

let hooked = false;

/** Imports a module of the PWA (a path under apps/web/src) with its supabase client swapped for this one. */
export async function importWeb<T>(file: string): Promise<T> {
  if (!hooked) {
    register('./redirect-supabase.mjs', import.meta.url);
    hooked = true;
  }
  const url = new URL(`../../../../apps/web/src/${file}`, import.meta.url).href;
  return (await import(url)) as T;
}
