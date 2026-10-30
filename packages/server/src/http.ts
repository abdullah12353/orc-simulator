// Request → response adapters for the Edge Functions. Runtime-neutral (Fetch API only), so the
// Deno entrypoints stay one-liners and tests can call these in-process from Node.
import { createWorld, CreateWorldError, type CreateWorldDeps } from './create-world.ts';
import { tickAllWorlds, tickWorld, type TickDeps } from './tick.ts';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** Constant-time-ish comparison so the secret can't be probed byte by byte. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * POST /tick with `Authorization: Bearer <TICK_SECRET>`. Body `{ "worldId": "..." }` ticks one world;
 * no body ticks every world (what the clock Worker sends).
 */
export async function handleTick(req: Request, deps: TickDeps & { secret: string }): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const auth = req.headers.get('authorization') ?? '';
  if (!deps.secret || !sameSecret(auth, `Bearer ${deps.secret}`)) return json({ error: 'unauthorized' }, 401);

  let worldId: string | undefined;
  const text = await req.text();
  if (text.trim()) {
    try {
      worldId = (JSON.parse(text) as { worldId?: string }).worldId;
    } catch {
      return json({ error: 'body must be JSON' }, 400);
    }
  }
  const outcomes = worldId ? [await tickWorld(deps, worldId)] : await tickAllWorlds(deps);
  return json({ outcomes });
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

/**
 * POST /create-world with the caller's Supabase JWT. `getUserId` resolves the bearer token to the
 * signed-in user (null if it isn't valid). Body `{ "name": "...", "displayName": "..." }`.
 */
export async function handleCreateWorld(
  req: Request,
  deps: CreateWorldDeps & { getUserId: (req: Request) => Promise<string | null> },
): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, CORS);
  const userId = await deps.getUserId(req);
  if (!userId) return json({ error: 'sign in first' }, 401, CORS);

  let body: { name?: unknown; displayName?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'body must be JSON' }, 400, CORS);
  }
  try {
    const out = await createWorld(deps, {
      userId,
      name: String(body.name ?? ''),
      displayName: String(body.displayName ?? ''),
    });
    return json(out, 201, CORS);
  } catch (e) {
    if (e instanceof CreateWorldError) return json({ error: e.message }, 400, CORS);
    throw e;
  }
}

/** Resolves a request's bearer token to a user id by asking Supabase Auth (works with any key type). */
export function supabaseUserResolver(opts: { supabaseUrl: string; anonKey: string; fetch?: typeof fetch }) {
  const doFetch = opts.fetch ?? fetch;
  return async (req: Request): Promise<string | null> => {
    const auth = req.headers.get('authorization');
    if (!auth?.startsWith('Bearer ')) return null;
    const res = await doFetch(`${opts.supabaseUrl}/auth/v1/user`, {
      headers: { authorization: auth, apikey: opts.anonKey },
    });
    if (!res.ok) return null;
    const user = (await res.json()) as { id?: string };
    return user.id ?? null;
  };
}
