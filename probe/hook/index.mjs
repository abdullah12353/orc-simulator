// Throwaway webhook catcher for #57: stores every POST (headers + body) in probe_hooks.
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2 });
export default {
  async fetch(req) {
    const body = await req.text();
    const headers = Object.fromEntries(req.headers);
    await sql`insert into probe_hooks (method, path, headers, body) values (${req.method}, ${new URL(req.url).pathname}, ${sql.json(headers)}, ${body})`;
    return Response.json({ ok: true });
  },
};
