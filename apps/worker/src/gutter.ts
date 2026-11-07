// The usage guard's Worker side (#70). The cron reads Neon's compute once per slot and keeps the last good
// reading in KV; the DOs and `GET /gutter` read it from there (never Postgres) and work the state out with
// `gutterState`, so the 1st lifts slow and closed even before a new reading.
import { CORS, GUTTER, gutterState, nextMonthStart, readNeonUsage, type GutterState, type UsageReading } from '@orc/server';
import type { Env } from './env.ts';

/** The last good reading, or null before the first. */
async function lastReading(env: Env): Promise<UsageReading | null> {
  return env.WORLDS.get<UsageReading>(GUTTER.kvKey, 'json').catch((e: unknown) => {
    console.error('gutter: KV read failed', e);
    return null;
  });
}

/** The gutter's state now, from KV. */
export async function storedGutter(env: Env, now = new Date()): Promise<GutterState> {
  return gutterState(await lastReading(env), now);
}

/**
 * The cron's reading: Neon's project API (a control-plane call, it doesn't wake Postgres), or the dev
 * stub. A good reading replaces the stored one; a failed one keeps it, so an API error never closes the
 * gutter (nor opens it). Returns the state to run this slot with. One KV write per slot: 48 a day.
 */
export async function refreshGutter(env: Env, now = new Date()): Promise<GutterState> {
  let reading: UsageReading | null = null;
  const stub = env.DEV_GUTTER_CU_HOURS?.trim();
  if (stub) {
    reading = { cuHours: Number(stub), periodEnd: nextMonthStart(now), readAt: now.toISOString() };
    console.warn(`gutter: DEV_GUTTER_CU_HOURS stubs the reading at ${stub} CU-h`);
  } else if (env.NEON_API_KEY && env.NEON_PROJECT_ID) {
    const fetcher: typeof fetch = (input, init) => fetch(input, init);
    reading = await readNeonUsage({ fetch: fetcher, projectId: env.NEON_PROJECT_ID, apiKey: env.NEON_API_KEY, now }).catch((e: unknown) => {
      console.error(`gutter: reading Neon's usage failed, keeping the last state: ${String(e)}`);
      return null;
    });
  } else {
    console.warn('gutter: NEON_API_KEY or NEON_PROJECT_ID unset, keeping the last state');
  }

  if (reading && Number.isFinite(reading.cuHours)) {
    await env.WORLDS.put(GUTTER.kvKey, JSON.stringify(reading)).catch((e: unknown) => console.error('gutter: KV write failed', e));
    const state = gutterState(reading, now);
    console.log(`gutter: ${reading.cuHours.toFixed(2)} CU-h this period (till ${reading.periodEnd}), ${state}`);
    return state;
  }
  return storedGutter(env, now);
}

/** `GET /gutter` → `{ state }`: public, from KV only, so the PWA can say so when it opens a world. */
export async function gutterRoute(req: Request, env: Env): Promise<Response> {
  const headers = { ...CORS, 'access-control-allow-methods': 'GET, OPTIONS' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'GET') return Response.json({ error: 'method not allowed' }, { status: 405, headers });
  return Response.json({ state: await storedGutter(env) }, { headers: { ...headers, 'cache-control': 'max-age=60' } });
}
