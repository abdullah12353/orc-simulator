// Thin Deno entrypoint. All logic lives in packages/server (tested in-process from Node).
import { connect, handleTick } from '@orc/server';

// ORC_DB_URL: in production the Supavisor transaction-mode URL (port 6543); the pool is created with
// `prepare: false` for that. Locally it's set in supabase/config.toml.
const sql = connect(Deno.env.get('ORC_DB_URL') ?? Deno.env.get('SUPABASE_DB_URL')!, { max: 1 });
const secret = Deno.env.get('TICK_SECRET') ?? '';

Deno.serve((req) => handleTick(req, { sql, now: () => new Date(), secret }));
