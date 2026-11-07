// The browser's way into Neon (#52, #53). Sign-in is Neon Auth (Managed Better Auth): magic links, a
// 7-day session that renews on use, and a 15-min JWT the client refreshes by itself. Every read and
// Player RPC (`db.from`, `db.rpc`) goes to Neon's Data API with that JWT, and RLS is the boundary.
// World jobs and the live socket go to the Worker instead (worker.ts), with the same JWT.
import { createClient } from '@neon/neon-js';

const required = (name: string, value: string | undefined): string => {
  const v = (value ?? '').trim().replace(/\/+$/, '');
  if (!v) throw new Error(`${name} is not set (run \`npm run web:env\` for local dev)`);
  return v;
};

const client = createClient({
  auth: { url: required('VITE_NEON_AUTH_URL', import.meta.env.VITE_NEON_AUTH_URL as string | undefined) },
  dataApi: { url: required('VITE_DATA_API_URL', import.meta.env.VITE_DATA_API_URL as string | undefined) },
});

/** Reads and Player RPCs over the Data API. With nobody signed in, a call fails before it's sent. */
export const db = client;

/** Neon Auth's Better Auth client: `signIn.magicLink`, `getSession`, `signOut`. */
export const auth = client.auth;

/** The signed-in Player's session (user and session), or null. Cached by the client, refetched near the JWT's expiry. */
export async function currentSession() {
  const { data } = await auth.getSession();
  return data ?? null;
}

/** The signed-in Player's current JWT (15 min, refreshed when it's near expiry), or null when signed out. */
export async function currentToken(): Promise<string | null> {
  return (await currentSession())?.session.token ?? null;
}

/** The signed-in user's id (`neon_auth.user.id`, the JWT's `sub`), or null. */
export async function currentUserId(): Promise<string | null> {
  return (await currentSession())?.user.id ?? null;
}
