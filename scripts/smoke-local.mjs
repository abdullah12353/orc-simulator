// End-to-end smoke test of the served stack, doing what the PWA does over HTTP:
// magic-link sign-in (code read from Mailpit) → create-world → ticks via the tick endpoint →
// read the world's Fact lines under RLS → invite a friend, who joins; a revoked invite is refused.
// `npm run smoke:local`. Needs the functions served by the
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
async function signIn(email) {
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
  return token;
}
const token = await signIn(email);

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

// 3b. The creator opens the Herald: edition #1 covers day zero, and the PWA can read it back under RLS.
const opened = await call('/functions/v1/open-edition', { method: 'POST', token, body: { worldId } });
if (!opened.created || opened.edition.no !== 1) throw new Error(`open-edition: ${JSON.stringify(opened).slice(0, 300)}`);
const stored = await call(`/rest/v1/editions?world_id=eq.${worldId}&select=no,edition_stories(rank,headline)`, { token });
if (stored.length !== 1 || stored[0].edition_stories.length !== opened.edition.stories.length) {
  throw new Error(`editions under RLS: ${JSON.stringify(stored).slice(0, 300)}`);
}
console.log(`edition #1 (${opened.edition.masthead.orcDate}) has ${opened.edition.stories.length} stories; lead: ${opened.edition.stories[0]?.headline}`);

// 4. An anonymous caller is refused.
const anonRes = await fetch(`${api}/rest/v1/facts?world_id=eq.${worldId}&select=no`, {
  headers: { apikey: anon, authorization: `Bearer ${anon}` },
});
if (anonRes.ok) throw new Error(`anon can read Facts: ${await anonRes.text()}`);
console.log(`anon is refused (${anonRes.status}): ok`);

// 5. Invites: the creator makes a link, a friend signs in and joins under their own name, the creator
// revokes it, and the next friend is refused with a clear reason (what the PWA shows).
const invite = await call('/rest/v1/rpc/create_invite', { method: 'POST', token, body: { world_id: worldId } });
const friend = await signIn(`smoke-friend-${Date.now()}@test.local`);
const [info] = await call('/rest/v1/rpc/invite_info', { method: 'POST', token: friend, body: { token: invite.token } });
if (info.status !== 'ok' || info.world_name !== 'Smoke Fortress') throw new Error(`invite_info: ${JSON.stringify(info)}`);
await call('/rest/v1/rpc/join_world', { method: 'POST', token: friend, body: { token: invite.token, display_name: 'Pal' } });
const names = await call(`/rest/v1/players?world_id=eq.${worldId}&select=display_name&order=joined_at`, { token: friend });
console.log('the friend joined; Players:', names.map((p) => p.display_name).join(', '));
const privateRows = await call('/rest/v1/player_private?select=player_id,gold,meddles_available', { token: friend });
if (privateRows.length !== 1) throw new Error(`the friend sees ${privateRows.length} player_private rows`);
const friendsView = await call(`/rest/v1/editions?world_id=eq.${worldId}&select=id`, { token: friend });
if (friendsView.length !== 0) throw new Error(`the friend can read ${friendsView.length} of the creator's editions`);

await call('/rest/v1/rpc/revoke_invite', { method: 'POST', token, body: { token: invite.token } });
const late = await signIn(`smoke-late-${Date.now()}@test.local`);
const refused = await fetch(`${api}/rest/v1/rpc/join_world`, {
  method: 'POST',
  headers: { apikey: anon, authorization: `Bearer ${late}`, 'content-type': 'application/json' },
  body: JSON.stringify({ token: invite.token, display_name: 'Late' }),
});
const reason = (await refused.json()).message;
if (refused.ok || reason !== 'invite_revoked') throw new Error(`revoked invite: ${refused.status} ${reason}`);
console.log(`a revoked invite is refused (${refused.status} ${reason}): ok`);

// 6. A Rumour, the way the PWA plants one: submit_intent debits a Meddle at once, the friend can't see
// it, and the next tick consumes it into a pending Meddle.
const [source, target] = await call(
  `/rest/v1/captains?world_id=eq.${worldId}&roster=eq.active&select=id,traits&order=id&limit=2`,
  { token },
);
const intentId = crypto.randomUUID();
const rumour = {
  id: intentId,
  world_id: worldId,
  kind: 'rumour',
  payload: { source: source.id, target: target.id, claim: 'insult', subject: { from: 'trait', key: target.traits[0] } },
};
const [submitted] = await call('/rest/v1/rpc/submit_intent', { method: 'POST', token, body: rumour });
const [again] = await call('/rest/v1/rpc/submit_intent', { method: 'POST', token, body: rumour });
if (submitted.meddles_left !== 2 || again.meddles_left !== 2) throw new Error(`submit_intent: ${JSON.stringify([submitted, again])}`);
await call('/functions/v1/tick', { method: 'POST', token: 'local-tick-secret', body: { worldId } });
const [mine] = await call(`/rest/v1/meddles?id=eq.${intentId}&select=status`, { token });
if (mine?.status !== 'pending') throw new Error(`the creator's Meddle after a tick: ${JSON.stringify(mine)}`);
const theirs = await call(`/rest/v1/meddles?id=eq.${intentId}&select=status`, { token: friend });
if (theirs.length !== 0) throw new Error('the friend can see a pending Meddle');
console.log('a Rumour was planted (2 Meddles left), consumed by the tick, and is secret from the friend: ok');
