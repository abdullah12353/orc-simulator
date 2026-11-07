// The thin router (#54 item 6, #52 item 6) and the 30-min catch-up cron (#54 item 4). The router only
// verifies the caller's Neon Auth JWT and hands the call to the world's Durable Object with the user id,
// so it stays far under the 20 ms of CPU a plain Worker gets. Everything else happens in the DO.
import { bearerToken, CORS, isUuid, jwtVerifier, type VerifyToken } from '@orc/server';
import { USER_HEADER, type Env } from './env.ts';
import { gutterRoute, refreshGutter } from './gutter.ts';

export { World } from './world.ts';

/**
 * What a world's DO answers under `/worlds/:id/…`. Creating a world is `POST /worlds`. `live` is the
 * Player's WebSocket (#68): a GET upgrade with the JWT in `?token=` (#52), since browsers can't set
 * headers on a socket.
 */
const WORLD_ACTIONS = new Set(['open', 'open-edition', 'create-clipping', 'live']);

type Route = { worldId: string | null; action: string };

/** `POST /worlds` → a new world; `/worlds/:id/:action` → that world. Anything else isn't ours. */
function route(pathname: string): Route | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 1 && parts[0] === 'worlds') return { worldId: null, action: 'create' };
  if (parts.length === 3 && parts[0] === 'worlds' && isUuid(parts[1]!) && WORLD_ACTIONS.has(parts[2]!)) {
    return { worldId: parts[1]!.toLowerCase(), action: parts[2]! };
  }
  return null;
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } });

/** Lives as long as the isolate, and so does its cache of Neon Auth's keys. */
let verify: VerifyToken | undefined;

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    // The usage guard's state (#70): public and from KV, so it needs no JWT and never wakes Postgres.
    if (url.pathname === '/gutter') return gutterRoute(req, env);
    const r = route(url.pathname);
    if (!r) return json({ error: 'not found' }, 404);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const live = r.action === 'live';
    if (req.method !== (live ? 'GET' : 'POST')) return json({ error: 'method not allowed' }, 405);
    if (live && req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'expected a websocket' }, 426);

    if (!env.NEON_AUTH_JWKS_URL || !env.NEON_AUTH_ISSUER) return json({ error: 'auth is not configured' }, 503);
    verify ??= jwtVerifier({ jwksUrl: env.NEON_AUTH_JWKS_URL, issuer: env.NEON_AUTH_ISSUER });
    const token = live ? url.searchParams.get('token') : bearerToken(req);
    let userId: string | null = null;
    try {
      userId = token ? await verify(token) : null;
    } catch (e) {
      console.error('JWT check failed', e);
      return json({ error: 'auth is unavailable' }, 503);
    }
    if (!userId) return json({ error: 'sign in first' }, 401);

    // A new world gets its id here, so the call lands in its own DO.
    const worldId = r.worldId ?? crypto.randomUUID();
    const stub = env.WORLD.get(env.WORLD.idFromName(worldId));
    const headers = new Headers({ 'content-type': 'application/json', [USER_HEADER]: userId });
    try {
      // The DO answers a socket with a 101; the token stays here, out of the DO's URL.
      if (live) return await stub.fetch(`https://world/${worldId}/live`, { headers: { Upgrade: 'websocket', [USER_HEADER]: userId } });
      return await stub.fetch(`https://world/${worldId}/${r.action}`, { method: 'POST', headers, body: await req.text() });
    } catch (e) {
      console.error(`world ${worldId} ${r.action} failed`, e);
      return json({ error: 'the world fell over' }, 500);
    }
  },

  /**
   * Every 30 minutes: every world in the KV list catches up (its DO arms an alarm for now), which also
   * restarts a world whose alarm died. The DOs do the work; this only fans out. First the usage guard
   * reads Neon's compute (#70): once the gutter is closed, the slots stop.
   */
  async scheduled(_controller, env): Promise<void> {
    if ((await refreshGutter(env)) === 'closed') {
      console.log('cron: the gutter is closed, no catch-ups till the 1st');
      return;
    }
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await env.WORLDS.list({ prefix: 'world:', ...(cursor ? { cursor } : {}) });
      ids.push(...page.keys.map((k) => k.name.slice('world:'.length)));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    const results = await Promise.allSettled(ids.map((id) => env.WORLD.get(env.WORLD.idFromName(id)).wake(id)));
    const failed = results.flatMap((res, i) => (res.status === 'rejected' ? [`${ids[i]}: ${String(res.reason)}`] : []));
    console.log(`cron: woke ${ids.length - failed.length} of ${ids.length} worlds`);
    for (const f of failed) console.error(`cron: wake failed for ${f}`);
  },
} satisfies ExportedHandler<Env>;
