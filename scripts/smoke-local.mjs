// End-to-end smoke test of the served stack, doing what the PWA does over HTTP:
// magic-link sign-in (code read from Mailpit) → create-world → ticks via the tick endpoint →
// read the world's Fact lines under RLS → invite a friend, who joins; a revoked invite is refused →
// a Rumour → both Players watch live on the private world channel, and a stranger is refused.
// `npm run smoke:local`. Needs the functions served by the
// stack (they're served from the worktree that ran `supabase start`).
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

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

// 7. Live watching, the way two open PWAs watch: both Players join the private channel world:<id> and
// a signed-in stranger is refused. The friend is marked seen, so the world is watched, and ticks run
// until one makes Facts: that tick's {tick_seq} broadcast reaches both, and refetching that tick's
// Facts (what the PWA does on a broadcast) finds them.
const topic = `world:${worldId}`;
async function joinChannel(accessToken) {
  const client = createClient(api, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  await client.realtime.setAuth(accessToken);
  const received = [];
  const channel = client.channel(topic, { config: { private: true } });
  channel.on('broadcast', { event: 'tick' }, (m) => received.push(m.payload));
  const status = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('NO_ANSWER'), 10_000);
    channel.subscribe((s) => {
      if (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
        clearTimeout(timer);
        resolve(s);
      }
    });
  });
  return { client, status, received };
}
const watchers = [await joinChannel(token), await joinChannel(friend)];
const outsider = await joinChannel(late);
try {
  if (watchers.some((w) => w.status !== 'SUBSCRIBED')) throw new Error(`members joining ${topic}: ${watchers.map((w) => w.status)}`);
  if (outsider.status === 'SUBSCRIBED') throw new Error(`a stranger joined ${topic}`);
  console.log(`both Players joined ${topic}; a stranger was refused (${outsider.status}): ok`);

  await call('/rest/v1/rpc/mark_seen', { method: 'POST', token: friend, body: { world_id: worldId } });
  let productive;
  for (let i = 0; i < 30 && !productive; i++) {
    const { outcomes } = await call('/functions/v1/tick', { method: 'POST', token: 'local-tick-secret', body: { worldId } });
    if (outcomes[0].status !== 'stepped') throw new Error(`a watched tick did not step: ${JSON.stringify(outcomes)}`);
    if (outcomes[0].factCount > 0) productive = outcomes[0];
  }
  if (!productive) throw new Error('no watched tick made Facts in 30 tries');
  for (let i = 0; i < 50 && watchers.some((w) => w.received.length === 0); i++) await new Promise((r) => setTimeout(r, 200));
  for (const w of watchers) {
    const seqs = w.received.map((p) => p.tick_seq);
    if (seqs.length !== 1 || seqs[0] !== productive.tickSeq) {
      throw new Error(`broadcasts received: ${JSON.stringify(seqs)}, expected [${productive.tickSeq}]`);
    }
  }
  if (outsider.received.length > 0) throw new Error('the stranger heard a broadcast');
  const fresh = await call(`/rest/v1/facts?world_id=eq.${worldId}&tick_seq=eq.${productive.tickSeq}&select=no,line`, { token: friend });
  if (fresh.length !== productive.factCount) throw new Error(`refetch found ${fresh.length} of ${productive.factCount} Facts`);
  console.log(`tick ${productive.tickSeq} made ${productive.factCount} Fact(s); both Players heard it once and refetched them: ok`);
} finally {
  for (const w of [...watchers, outsider]) {
    await w.client.removeAllChannels();
    w.client.realtime.disconnect();
  }
}
