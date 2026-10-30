// Thin Deno entrypoint. All logic lives in packages/server (tested in-process from Node).
import { connect, handleOpenEdition, providerKeysFromEnv, supabaseUserResolver } from '@orc/server';

const sql = connect(Deno.env.get('ORC_DB_URL') ?? Deno.env.get('SUPABASE_DB_URL')!, { max: 1 });
const getUserId = supabaseUserResolver({
  supabaseUrl: Deno.env.get('SUPABASE_URL')!,
  anonKey: Deno.env.get('SUPABASE_ANON_KEY')!,
});
// The same narration secrets as the tick. Without any, every edition stays templated and no call is made.
const providers = providerKeysFromEnv((name) => Deno.env.get(name));

declare const EdgeRuntime: { waitUntil(work: Promise<unknown>): void };

Deno.serve((req) =>
  handleOpenEdition(req, {
    sql,
    now: () => new Date(),
    getUserId,
    narration: { fetch, providers },
    waitUntil: (work) => EdgeRuntime.waitUntil(work),
  }),
);
