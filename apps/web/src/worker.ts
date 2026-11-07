// The one Worker (#62): where it is, and the JWT it checks (#52). The live socket uses both; #69 moves the
// world jobs (create world, open edition, clip) here too, and points `workerToken` at Neon Auth.
import { supabase } from './supabase.ts';

/** `VITE_WORKER_URL`; locally, `npm run dev:worker` (wrangler dev) on its default port. */
export const WORKER_URL = ((import.meta.env.VITE_WORKER_URL as string | undefined) ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');

/** The signed-in Player's current JWT, or null when signed out. */
export async function workerToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
