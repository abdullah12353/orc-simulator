// Request → response adapters for the world's Durable Object. Runtime-neutral (Fetch API only), so the
// DO stays a thin shell and tests can call these in-process from Node. The Worker has already verified
// the caller's JWT (auth.ts); `getUserId` hands the DO the user id it passed along.
import { ClippingError, createClipping, type ClippingDeps } from './clippings.ts';
import { createWorld, CreateWorldError, type CreateWorldDeps } from './create-world.ts';
import { openEdition, OpenEditionError, type OpenEditionDeps } from './herald.ts';
import type { TickDeps } from './tick.ts';
import { openWorld, OpenWorldError } from './world.ts';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

/** What every signed-in endpoint needs: `getUserId` gives the verified caller (null: not signed in). */
interface UserDeps {
  getUserId: (req: Request) => Promise<string | null>;
}

type ErrorClass = abstract new (...args: never[]) => Error;

/**
 * A POST from the PWA by a signed-in user, with a JSON body: answers the CORS preflight, refuses other
 * methods (405), strangers (401) and bodies that aren't JSON (400), and turns the core's refusal errors
 * (their message is the reason) into `status`. Anything else is a real error and propagates.
 */
function userEndpoint<D extends UserDeps>(
  refusal: { errors: ErrorClass[]; status: number },
  handle: (deps: D, userId: string, body: Record<string, unknown>) => Promise<Response>,
): (req: Request, deps: D) => Promise<Response> {
  return async (req, deps) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, CORS);
    const userId = await deps.getUserId(req);
    if (!userId) return json({ error: 'sign in first' }, 401, CORS);
    let body: Record<string, unknown>;
    try {
      const text = await req.text();
      body = (text.trim() ? JSON.parse(text) : {}) ?? {};
    } catch {
      return json({ error: 'body must be JSON' }, 400, CORS);
    }
    try {
      return await handle(deps, userId, body);
    } catch (e) {
      if (refusal.errors.some((cls) => e instanceof cls)) return json({ error: (e as Error).message }, refusal.status, CORS);
      throw e;
    }
  };
}

/** The world a call is for: the Worker routes `/worlds/:id/*` to that world's DO and passes the id on. */
interface WorldDeps {
  worldId: string;
}

/**
 * POST /worlds with the caller's JWT. Body `{ "name": "...", "displayName": "..." }`. The Worker picks the
 * new world's id (`worldId`) and routes the call to that world's DO. Returns `{ worldId, playerId }` (201).
 */
export const handleCreateWorld = userEndpoint<CreateWorldDeps & UserDeps & Partial<WorldDeps>>(
  { errors: [CreateWorldError], status: 400 },
  async (deps, userId, body) =>
    json(
      await createWorld(deps, { worldId: deps.worldId, userId, name: String(body.name ?? ''), displayName: String(body.displayName ?? '') }),
      201,
      CORS,
    ),
);

/**
 * POST /worlds/:id/open with the caller's JWT: the world catches up (#53 item 2) and answers
 * `{ tick_seq }`. #68's live connection does the same before its `ready`.
 */
export const handleOpenWorld = userEndpoint<TickDeps & UserDeps & WorldDeps>(
  { errors: [OpenWorldError], status: 403 },
  async (deps, userId) => {
    const { tickSeq } = await openWorld(deps, { userId, worldId: deps.worldId });
    return json({ tick_seq: tickSeq }, 200, CORS);
  },
);

/**
 * POST /worlds/:id/open-edition with the caller's JWT. The world catches up first (data-model §3 step 10),
 * then returns the caller's `OpenEditionResult`: a new edition if one is due, otherwise the last one plus
 * a Stop press.
 */
export const handleOpenEdition = userEndpoint<OpenEditionDeps & UserDeps & WorldDeps>(
  { errors: [OpenWorldError, OpenEditionError], status: 403 },
  async (deps, userId) => {
    await openWorld(deps, { userId, worldId: deps.worldId });
    return json(await openEdition(deps, { userId, worldId: deps.worldId }), 200, CORS);
  },
);

/**
 * POST /worlds/:id/create-clipping with the caller's JWT. Body `{ "editionId", "storyNo" }`: a story
 * printed in one of the caller's own editions. Returns `{ id, snapshot }` (201).
 */
export const handleCreateClipping = userEndpoint<ClippingDeps & UserDeps & WorldDeps>(
  { errors: [ClippingError], status: 403 },
  async (deps, userId, body) => {
    const editionId = String(body.editionId ?? '');
    const storyNo = Number(body.storyNo);
    if (!isUuid(editionId)) return json({ error: 'editionId must be a uuid' }, 400, CORS);
    if (!Number.isSafeInteger(storyNo) || storyNo < 1) return json({ error: 'storyNo must be a Fact number' }, 400, CORS);
    return json(await createClipping(deps, { userId, worldId: deps.worldId, editionId, storyNo }), 201, CORS);
  },
);
