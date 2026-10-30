// End-to-end smoke test of the served stack, doing what the PWA does over HTTP:
// magic-link sign-in (code read from Mailpit) → create-world → ticks via the tick endpoint →
// read the world's Fact lines under RLS. `npm run smoke:local`. Needs the functions served by the
// stack (they're served from the worktree that ran `supabase start`).
import { execSync } from 'node:child_process';

const status = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8' }));
const api = status.API_URL;
const anon = status.ANON_KEY;
const mailpit = status.MAILPIT_URL;
const email = `smoke-${Date.now()}@test.local`;

async function call(path, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      apikey: anon,
      authorization: `Bearer ${token ?? anon}`,
      'content-type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

// 1. Magic link: request it, find the link in Mailpit and follow it like a browser would. Auth
// redirects to the app with the session in the URL fragment.
await call('/auth/v1/otp', { method: 'POST', body: { email, create_user: true } });
let link;
for (let i = 0; i < 30 && !link; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const list = await (await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
  const id = list.messages?.[0]?.ID;
  if (!id) continue;
  const msg = await (await fetch(`${mailpit}/api/v1/message/${id}`)).json();
  link = /href="([^"]*\/auth\/v1\/verify[^"]*)"/.exec(msg.HTML ?? '')?.[1]?.replaceAll('&amp;', '&');
}
if (!link) throw new Error('no magic link arrived in Mailpit');
const redirect = await fetch(link, { redirect: 'manual' });
const token = new URLSearchParams(new URL(redirect.headers.get('location')).hash.slice(1)).get('access_token');
if (!token) throw new Error(`magic link did not sign in: ${redirect.status} ${redirect.headers.get('location')}`);
console.log('signed in by magic link as', email);

// 2. Create a world through the Edge Function, as the signed-in creator.
const { worldId } = await call('/functions/v1/create-world', {
  method: 'POST',
  token,
  body: { name: 'Smoke Fortress', displayName: 'Smoky' },
});
console.log('created world', worldId);

// 3. Tick it through the tick endpoint until something happens.
let lines = [];
for (let i = 0; i < 60 && lines.length < 2; i++) {
  await call('/functions/v1/tick', { method: 'POST', token: 'local-tick-secret', body: { worldId } });
  lines = await call(`/rest/v1/facts?world_id=eq.${worldId}&select=no,at,line&order=at.desc,no.desc`, { token });
}
if (lines.length === 0) throw new Error('no Facts after 60 ticks');
console.log(`the creator sees ${lines.length} Fact line(s), newest first:`);
for (const f of lines) console.log(`  #${f.no} ${f.at}  ${f.line}`);

// 4. An anonymous caller is refused.
const anonRes = await fetch(`${api}/rest/v1/facts?world_id=eq.${worldId}&select=no`, {
  headers: { apikey: anon, authorization: `Bearer ${anon}` },
});
if (anonRes.ok) throw new Error(`anon can read Facts: ${await anonRes.text()}`);
console.log(`anon is refused (${anonRes.status}): ok`);
