// Thin Deno entrypoint. All logic lives in packages/server (tested in-process from Node).
import { connect, handleCreateWorld, supabaseUserResolver } from '@orc/server';

const sql = connect(Deno.env.get('SUPABASE_DB_URL')!, { max: 1 });
const getUserId = supabaseUserResolver({
  supabaseUrl: Deno.env.get('SUPABASE_URL')!,
  anonKey: Deno.env.get('SUPABASE_ANON_KEY')!,
});

Deno.serve((req) =>
  handleCreateWorld(req, {
    sql,
    now: () => new Date(),
    randomSeed: () => crypto.getRandomValues(new Uint32Array(1))[0]!,
    getUserId,
  }),
);
