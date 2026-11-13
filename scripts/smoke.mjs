// End-to-end smoke test against the Neon `dev` branch (#61 item 4, #71), doing over HTTP what the PWA does:
// sign in with email and password → create a world on the Worker → day zero's Facts through the Data API →
// the live socket's `ready` → the Herald → an invite a friend joins, and a revoked one refused → a Rumour
// that the next tick lands.
//
//   npm run dev:worker     # in another terminal: wrangler dev on :8787, with apps/worker/.dev.vars
//   npm run smoke
//
// It reads the dev branch's Neon Auth and Data API URLs from .env.local (NEON_AUTH_BASE_URL or
// NEON_AUTH_URL, and NEON_DATA_API_URL), which `provision.mjs` or `neon env pull` writes. The environment
// wins over the file. SMOKE_WORKER_URL points it at another Worker (default http://127.0.0.1:8787).
// Each run signs up three throwaway users (smoke-*@example.com) and makes one world on the dev branch.
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readEnv } from './env-file.mjs';

const local = readEnv(fileURLToPath(new URL('../.env.local', import.meta.url)));
const pick = (...keys) => keys.map((k) => process.env[k] || local[k]).find(Boolean)?.replace(/\/+$/, '');
const AUTH = pick('NEON_AUTH_URL', 'NEON_AUTH_BASE_URL');
const DATA = pick('NEON_DATA_API_URL');
const WORKER = pick('SMOKE_WORKER_URL') ?? 'http://127.0.0.1:8787';
// A trusted origin on the dev branch (localhost), as the PWA under `npm run dev:web` sends.
const ORIGIN = 'http://localhost:5173';
const TIMEOUT = 90_000;

if (!AUTH || !DATA) {
  console.error('✗ No NEON_AUTH_BASE_URL / NEON_DATA_API_URL in .env.local or the environment.');
  console.error('  Run `node scripts/provision.mjs` (or `neon env pull --branch dev`) first.');
  process.exit(2);
}
if ((process.env.NEON_BRANCH || local.NEON_BRANCH) && (process.env.NEON_BRANCH || local.NEON_BRANCH) !== 'dev') {
  console.error(`✗ .env.local is for the ${process.env.NEON_BRANCH || local.NEON_BRANCH} branch; smoke runs against dev (it signs up users).`);
  process.exit(2);
}

const step = (line) => console.log(`✓ ${line}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(url, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { res, body: parsed };
}

async function call(url, options) {
  const { res, body } = await request(url, options);
  if (!res.ok) throw new Error(`${options?.method ?? 'GET'} ${url} → ${res.status} ${JSON.stringify(body)}`);
  return body;
}
const data = (path, options) => call(`${DATA}${path}`, options);
const worker = (path, options) => call(`${WORKER}${path}`, { method: 'POST', body: {}, ...options });

// 0. The Worker is up.
try {
  await fetch(`${WORKER}/gutter`, { signal: AbortSignal.timeout(10_000) });
} catch {
  console.error(`✗ Nothing answers at ${WORKER}. Start the Worker first: npm run dev:worker`);
  process.exit(2);
}

// 1. Email and password (on dev only): sign up, then sign in like a returning Player, and take the JWT
// Neon Auth hands out with the session (`set-auth-jwt`), as @neon/neon-js does.
async function signIn(label) {
  const email = `smoke-${label}-${Date.now()}@example.com`;
  const password = `pw-${randomUUID()}`;
  const auth = (path, body) =>
    fetch(`${AUTH}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT),
    });
  const up = await auth('/sign-up/email', { email, password, name: label });
  if (!up.ok) throw new Error(`sign-up ${email} → ${up.status} ${await up.text()}`);
  const signedIn = await auth('/sign-in/email', { email, password });
  if (!signedIn.ok) throw new Error(`sign-in ${email} → ${signedIn.status} ${await signedIn.text()}`);
  const cookie = signedIn.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const session = await fetch(`${AUTH}/get-session`, { headers: { cookie, origin: ORIGIN }, signal: AbortSignal.timeout(TIMEOUT) });
  const token = session.headers.get('set-auth-jwt');
  const { user } = (await session.json()) ?? {};
  if (!session.ok || !token || !user) throw new Error(`get-session for ${email} → ${session.status}, no JWT`);
  return { email, token, userId: user.id };
}
const creator = await signIn('creator');
step(`signed in with email and password as ${creator.email}`);

// 2. Create a world on the Worker: its DO casts it and writes day zero.
const { worldId } = await worker('/worlds', { token: creator.token, body: { name: 'Smoke Fortress', displayName: 'Smoky' } });
step(`created world ${worldId}`);

// 3. Day zero, read back through the Data API under RLS.
const facts = await data(`/facts?world_id=eq.${worldId}&select=no,at,line&order=no.asc`, { token: creator.token });
if (facts.length === 0) throw new Error('no day-zero Facts');
step(`day zero: ${facts.length} Fact line(s), first: ${facts[0].line}`);
const captains = await data(`/captains?world_id=eq.${worldId}&roster=eq.active&select=id,traits&order=id`, { token: creator.token });
if (captains.length < 2) throw new Error(`${captains.length} active Captains`);

// 4. Signed out, the Data API reads nothing.
const { res: anon } = await request(`${DATA}/facts?world_id=eq.${worldId}&select=no`);
if (anon.ok) throw new Error('a signed-out request read Facts');
step(`signed out, the Data API refuses (${anon.status})`);

// 5. The live socket: the world catches up and says `ready`; its ticks come over it while it's open.
const messages = [];
let onMessage = () => {};
const socket = new WebSocket(`${WORKER.replace(/^http/, 'ws')}/worlds/${worldId}/live?token=${encodeURIComponent(creator.token)}`);
socket.addEventListener('message', (e) => {
  if (e.data === 'pong') return; // the runtime's answer to our keep-alive ping
  const m = JSON.parse(String(e.data));
  messages.push(m);
  onMessage(m);
});
const closed = new Promise((resolve) => socket.addEventListener('close', (e) => resolve(e.code)));
function nextMessage(type, ms = TIMEOUT) {
  const seen = messages.find((m) => m.type === type && !m.used);
  if (seen) return Promise.resolve(Object.assign(seen, { used: true }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${type} on the live socket within ${ms / 1000} s`)), ms);
    onMessage = (m) => {
      if (m.type !== type) return;
      clearTimeout(timer);
      onMessage = () => {};
      resolve(Object.assign(m, { used: true }));
    };
    closed.then((code) => reject(new Error(`the live socket closed (${code}) before ${type}`)));
  });
}
const ready = await nextMessage('ready', 120_000);
step(`live socket ready at tick_seq ${ready.tick_seq}`);
const ping = setInterval(() => socket.readyState === WebSocket.OPEN && socket.send('ping'), 20_000);

// 6. The Herald: edition #1 covers day zero, and reads back under RLS.
const opened = await worker(`/worlds/${worldId}/open-edition`, { token: creator.token });
if (!opened?.edition || opened.edition.no !== 1) throw new Error(`open-edition: ${JSON.stringify(opened).slice(0, 300)}`);
const stored = await data(`/editions?world_id=eq.${worldId}&select=no,edition_stories(rank,headline)`, { token: creator.token });
if (stored.length !== 1 || stored[0].edition_stories.length !== opened.edition.stories.length) {
  throw new Error(`editions under RLS: ${JSON.stringify(stored).slice(0, 300)}`);
}
step(`Herald edition #1 has ${opened.edition.stories.length} stories; lead: ${opened.edition.stories[0]?.headline}`);

// 7. Invites: a friend joins under their own name; a revoked link refuses the next one, with the reason.
const invite = await data('/rpc/create_invite', { method: 'POST', token: creator.token, body: { world_id: worldId } });
const friend = await signIn('friend');
const [info] = await data('/rpc/invite_info', { method: 'POST', token: friend.token, body: { token: invite.token } });
if (info?.status !== 'ok' || info.world_name !== 'Smoke Fortress') throw new Error(`invite_info: ${JSON.stringify(info)}`);
await data('/rpc/join_world', { method: 'POST', token: friend.token, body: { token: invite.token, display_name: 'Pal' } });
const names = await data(`/players?world_id=eq.${worldId}&select=display_name&order=joined_at`, { token: friend.token });
const privateRows = await data('/player_private?select=player_id', { token: friend.token });
if (privateRows.length !== 1) throw new Error(`the friend sees ${privateRows.length} player_private rows`);
const friendsView = await data(`/editions?world_id=eq.${worldId}&select=id`, { token: friend.token });
if (friendsView.length !== 0) throw new Error(`the friend can read ${friendsView.length} of the creator's editions`);
step(`the friend joined; Players: ${names.map((p) => p.display_name).join(', ')}`);

await data('/rpc/revoke_invite', { method: 'POST', token: creator.token, body: { token: invite.token } });
const late = await signIn('late');
const { res: refused, body: refusal } = await request(`${DATA}/rpc/join_world`, {
  method: 'POST',
  token: late.token,
  body: { token: invite.token, display_name: 'Late' },
});
if (refused.ok || refusal?.message !== 'invite_revoked') throw new Error(`revoked invite: ${refused.status} ${JSON.stringify(refusal)}`);
step(`a revoked invite is refused (${refused.status} ${refusal.message})`);

// 8. A Rumour, the way the PWA plants one: submit_intent spends a Meddle at once (a resend doesn't), and
// the next tick (the world is watched, so within the minute) turns it into the creator's pending Meddle,
// which the friend can't see.
const [source, target] = captains;
const intentId = randomUUID();
const rumour = {
  id: intentId,
  world_id: worldId,
  kind: 'rumour',
  payload: { source: source.id, target: target.id, claim: 'insult', subject: { from: 'trait', key: target.traits[0] } },
};
const [submitted] = await data('/rpc/submit_intent', { method: 'POST', token: creator.token, body: rumour });
const [again] = await data('/rpc/submit_intent', { method: 'POST', token: creator.token, body: rumour });
if (submitted.meddles_left !== 2 || again.meddles_left !== 2) throw new Error(`submit_intent: ${JSON.stringify([submitted, again])}`);
step('planted a Rumour (2 Meddles left; the resend spent nothing)');
// The socket only hears about ticks that made Facts, so this watches the Meddle itself.
const [{ tick_seq: plantedAt }] = await data(`/worlds?id=eq.${worldId}&select=tick_seq`, { token: creator.token });
let landedAt = null;
for (const deadline = Date.now() + 180_000; Date.now() < deadline && landedAt === null; ) {
  await wait(5000);
  if (socket.readyState !== WebSocket.OPEN) throw new Error('the live socket closed while waiting for the tick');
  const [mine] = await data(`/meddles?id=eq.${intentId}&select=status`, { token: creator.token });
  if (mine?.status === 'pending') [{ tick_seq: landedAt }] = await data(`/worlds?id=eq.${worldId}&select=tick_seq`, { token: creator.token });
}
if (landedAt === null) throw new Error('the Rumour never became a pending Meddle (3 min, the world watched)');
const theirs = await data(`/meddles?id=eq.${intentId}&select=status`, { token: friend.token });
if (theirs.length !== 0) throw new Error('the friend can see a pending Meddle');
step(`the tick from tick_seq ${plantedAt} to ${landedAt} landed the Rumour as a pending Meddle, secret from the friend`);

clearInterval(ping);
socket.close(1000, 'smoke done');
console.log('\nsmoke passed');
process.exit(0);
