// Throwaway for #57 item 6: one query through Hyperdrive, then nothing. Does Hyperdrive's own pool keep Neon awake?
import postgres from "postgres";
export default {
  async fetch(req, env) {
    const sql = postgres(env.HD.connectionString, { prepare: false, max: 1, fetch_types: false });
    const [r] = await sql`select now() as at, pg_backend_pid() as pid`;
    await sql.end();
    return Response.json(r);
  },
};
