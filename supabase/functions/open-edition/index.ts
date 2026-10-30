// Thin Deno entrypoint. All logic lives in packages/server (tested in-process from Node).
import { connect, handleOpenEdition, supabaseUserResolver } from '@orc/server';

const sql = connect(Deno.env.get('ORC_DB_URL') ?? Deno.env.get('SUPABASE_DB_URL')!, { max: 1 });
const getUserId = supabaseUserResolver({
  supabaseUrl: Deno.env.get('SUPABASE_URL')!,
  anonKey: Deno.env.get('SUPABASE_ANON_KEY')!,
});

Deno.serve((req) => handleOpenEdition(req, { sql, now: () => new Date(), getUserId }));
