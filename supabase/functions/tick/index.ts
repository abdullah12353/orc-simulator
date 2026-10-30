// Thin Deno entrypoint. All logic lives in packages/server (tested in-process from Node).
import { connect, handleTick } from '@orc/server';

// SUPABASE_DB_URL is provided by the platform. In production point it at Supavisor in transaction
// mode (port 6543); the pool is created with `prepare: false` for that.
const sql = connect(Deno.env.get('SUPABASE_DB_URL')!, { max: 1 });
const secret = Deno.env.get('TICK_SECRET') ?? '';

Deno.serve((req) => handleTick(req, { sql, now: () => new Date(), secret }));
