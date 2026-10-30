// Thin Deno entrypoint. All logic lives in packages/server (tested in-process from Node).
import { connect, handleTick, providerKeysFromEnv, vapidFromEnv } from '@orc/server';

// ORC_DB_URL: in production the Supavisor transaction-mode URL (port 6543); the pool is created with
// `prepare: false` for that. Locally it's set in supabase/config.toml.
const sql = connect(Deno.env.get('ORC_DB_URL') ?? Deno.env.get('SUPABASE_DB_URL')!, { max: 1 });
const secret = Deno.env.get('TICK_SECRET') ?? '';

// Narration secrets (`supabase secrets set`), unset until the accounts exist. A provider without its keys
// is skipped; with none, every Clash keeps its fallback script and no call is made.
const providers = providerKeysFromEnv((name) => Deno.env.get(name));

// Web Push (#42): VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY (+ VAPID_SUBJECT), set by the operator. Unset, no
// push is ever sent: they stay queued and go stale.
const vapid = vapidFromEnv((name) => Deno.env.get(name));

declare const EdgeRuntime: { waitUntil(work: Promise<unknown>): void };

Deno.serve((req) =>
  handleTick(req, {
    sql,
    now: () => new Date(),
    secret,
    narration: { fetch, providers },
    pushes: { fetch, vapid },
    waitUntil: (work) => EdgeRuntime.waitUntil(work),
  }),
);
