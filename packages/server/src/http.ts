// Request → response adapters for the Edge Functions. Runtime-neutral (Fetch API only), so the
// Deno entrypoints stay one-liners and tests can call these in-process from Node.
import { ClippingError, createClipping, type ClippingDeps } from './clippings.ts';
import { createWorld, CreateWorldError, type CreateWorldDeps } from './create-world.ts';
import { openEdition, OpenEditionError, type OpenEditionDeps } from './herald.ts';
import { drainJobs, type NarrationDeps } from './narration/index.ts';
import { drainPushes, type PushDeps } from './pushes.ts';
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

export interface TickHandlerDeps extends TickDeps {
  secret: string;
  /** Narration's providers. Without it, Clash jobs stay queued (a later drain picks them up). */
  narration?: Pick<NarrationDeps, 'fetch' | 'providers' | 'timeoutMs'>;
  /** Web Push (#42). Without it, or with `vapid: null`, queued pushes are never sent (they go stale). */
  pushes?: Pick<PushDeps, 'fetch' | 'vapid'>;
  /** Keeps background work alive after the response (`EdgeRuntime.waitUntil`). */
  waitUntil?: (work: Promise<unknown>) => void;
}

/**
 * POST /tick with `Authorization: Bearer <TICK_SECRET>`. Body `{ "worldId": "..." }` ticks one world;
 * no body ticks every world (what the clock Worker sends). After the ticks commit it answers, and
 * sends the stepped worlds' queued pushes and drains their narration jobs in the background (data-model §3 step 7).
 */
export async function handleTick(req: Request, deps: TickHandlerDeps): Promise<Response> {
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
  const stepped = outcomes.flatMap((o) => (o.status === 'stepped' ? [o.worldId] : []));
  if (stepped.length > 0 && (deps.narration || deps.pushes?.vapid)) {
    // Pushes first: they're quick, and late ones are worse than late dialogue.
    const work = (async () => {
      if (deps.pushes?.vapid) {
        await drainPushes({ ...deps.pushes, sql: deps.sql, now: deps.now }, { worldIds: stepped }).catch((e: unknown) =>
          console.error('drainPushes failed', e),
        );
      }
      if (deps.narration) {
        await drainJobs({ ...deps.narration, sql: deps.sql, now: deps.now, content: deps.content }, { worldIds: stepped }).catch(
          (e: unknown) => console.error('drainJobs failed', e),
        );
      }
    })();
    deps.waitUntil?.(work);
  }
  return json({ outcomes });
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const UUID = /^[0-9a-f-]{36}$/i;

/** What every signed-in endpoint needs: `getUserId` resolves the bearer token (null if it isn't valid). */
interface UserDeps {
  getUserId: (req: Request) => Promise<string | null>;
}

/**
 * A POST from the PWA by a signed-in user, with a JSON body: answers the CORS preflight, refuses other
 * methods (405), strangers (401) and bodies that aren't JSON (400), and turns the core's refusal error
 * (its message is the reason) into `status`. Anything else is a real error and propagates.
 */
function userEndpoint<D extends UserDeps>(
  refusal: { error: abstract new (...args: never[]) => Error; status: number },
  handle: (deps: D, userId: string, body: Record<string, unknown>) => Promise<Response>,
): (req: Request, deps: D) => Promise<Response> {
  return async (req, deps) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, CORS);
    const userId = await deps.getUserId(req);
    if (!userId) return json({ error: 'sign in first' }, 401, CORS);
    let body: Record<string, unknown>;
    try {
      body = ((await req.json()) ?? {}) as Record<string, unknown>;
    } catch {
      return json({ error: 'body must be JSON' }, 400, CORS);
    }
    try {
      return await handle(deps, userId, body);
    } catch (e) {
      if (e instanceof refusal.error) return json({ error: e.message }, refusal.status, CORS);
      throw e;
    }
  };
}

/** POST /create-world with the caller's Supabase JWT. Body `{ "name": "...", "displayName": "..." }`. */
export const handleCreateWorld = userEndpoint<CreateWorldDeps & UserDeps>(
  { error: CreateWorldError, status: 400 },
  async (deps, userId, body) =>
    json(await createWorld(deps, { userId, name: String(body.name ?? ''), displayName: String(body.displayName ?? '') }), 201, CORS),
);

/**
 * POST /open-edition with the caller's Supabase JWT. Body `{ "worldId": "..." }`. Returns the caller's
 * `OpenEditionResult`: a new edition if one is due, otherwise the last one plus a Stop press.
 */
export const handleOpenEdition = userEndpoint<OpenEditionDeps & UserDeps>(
  { error: OpenEditionError, status: 403 },
  async (deps, userId, body) => {
    const worldId = String(body.worldId ?? '');
    if (!UUID.test(worldId)) return json({ error: 'worldId must be a uuid' }, 400, CORS);
    return json(await openEdition(deps, { userId, worldId }), 200, CORS);
  },
);

/**
 * POST /create-clipping with the caller's Supabase JWT. Body `{ "worldId", "editionId", "storyNo" }`: a story
 * printed in one of the caller's own editions. Returns `{ id, snapshot }` (201).
 */
export const handleCreateClipping = userEndpoint<ClippingDeps & UserDeps>(
  { error: ClippingError, status: 403 },
  async (deps, userId, body) => {
    const worldId = String(body.worldId ?? '');
    const editionId = String(body.editionId ?? '');
    const storyNo = Number(body.storyNo);
    if (!UUID.test(worldId) || !UUID.test(editionId)) return json({ error: 'worldId and editionId must be uuids' }, 400, CORS);
    if (!Number.isSafeInteger(storyNo) || storyNo < 1) return json({ error: 'storyNo must be a Fact number' }, 400, CORS);
    return json(await createClipping(deps, { userId, worldId, editionId, storyNo }), 201, CORS);
  },
);

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
