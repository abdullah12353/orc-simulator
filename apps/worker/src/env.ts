import type { WorkersAi } from '@orc/server';
import type { World } from './world.ts';

/** The Worker's bindings, secrets and vars (#62 item 4). */
export interface Env {
  /** One Durable Object per world, named by the world's id. */
  WORLD: DurableObjectNamespace<World>;
  /** The world list the cron walks: `world:<id>` → when it was created. */
  WORLDS: KVNamespace;
  /** Workers AI, for narration. */
  AI?: WorkersAi;

  /** Secret: Neon's pooled (`-pooler`) connection string. */
  NEON_DB_URL: string;
  /** Secret: narration's fallback provider. Unset, Groq is skipped. */
  GROQ_API_KEY?: string;
  /** Secret: Web Push. Unset (or without the public key), pushes stay queued and go stale. */
  VAPID_PRIVATE_KEY?: string;
  /** Secret: the usage guard's project-scoped Neon API key (#70). */
  NEON_API_KEY?: string;

  /** Neon Auth's JWKS: `…/neondb/auth/.well-known/jwks.json`. */
  NEON_AUTH_JWKS_URL: string;
  /** The tokens' `iss`: the Neon Auth host's origin. */
  NEON_AUTH_ISSUER: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_SUBJECT?: string;
  /** For the usage guard (#70). */
  NEON_PROJECT_ID?: string;
}

/** The header the router hands the verified user id to the world's DO in. Only the router can set it. */
export const USER_HEADER = 'x-orc-user-id';
