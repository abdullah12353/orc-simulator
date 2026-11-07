// The one Worker (#62): where it is, and the JWT it checks (#52). The live socket uses both, and so do the
// world jobs (create world, open edition, clip), which the world's Durable Object runs (#69).
import { currentToken } from './db.ts';
import { readWorkerAnswer, type WorkerAnswer } from './worker-answer.ts';

/** `VITE_WORKER_URL`; locally, `npm run dev:worker` (wrangler dev) on its default port. */
export const WORKER_URL = ((import.meta.env.VITE_WORKER_URL as string | undefined) || 'http://127.0.0.1:8787').trim().replace(/\/+$/, '');

/** The signed-in Player's current Neon Auth JWT, or null when signed out. */
export const workerToken = currentToken;

/**
 * A world job: `POST {VITE_WORKER_URL}{path}` with the JWT. Writes never wait for the live socket's
 * `ready` (#53 item 2). Answers the data, or the line to show (a 503 `gutter_closed` is the closed gutter).
 */
export async function worldJob<T>(path: string, body: unknown, fallback: string): Promise<WorkerAnswer<T>> {
  const token = await workerToken();
  if (!token) return readWorkerAnswer<T>(new Response(null, { status: 401 }), fallback);
  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { error: fallback };
  }
  return readWorkerAnswer<T>(res, fallback);
}
