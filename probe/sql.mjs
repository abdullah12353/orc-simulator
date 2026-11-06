// Usage: node sql.mjs "<sql>"  or  node sql.mjs -f file.sql   (uses NEON_DB_URL_DIRECT from the main checkout's .env.deploy)
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { env } from "./env.mjs";
const sql = postgres(env.NEON_DB_URL_DIRECT, { prepare: false, onnotice: () => {} });
const text = process.argv[2] === "-f" ? readFileSync(process.argv[3], "utf8") : process.argv[2];
try {
  const r = await sql.unsafe(text).simple();
  const sets = Array.isArray(r[0]) || (r.length && r[0]?.count !== undefined && Array.isArray(r[0])) ? r : [r];
  for (const s of sets) console.table(s.length ? s : [{ result: s.command ?? "ok" }]);
} catch (e) { console.error("ERROR:", e.message); process.exitCode = 1; }
await sql.end();
