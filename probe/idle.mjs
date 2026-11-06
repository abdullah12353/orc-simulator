// Item 6: does an idle connection keep the compute awake past the 5-minute suspend?
// mode: pooled | direct | none. Opens one connection, runs one query, then sits idle and watches the endpoint state
// through the Neon API (which doesn't wake the compute).
import postgres from "postgres";
import { execSync } from "node:child_process";
import { env } from "./env.mjs";
const mode = process.argv[2] ?? "pooled", minutes = Number(process.argv[3] ?? 9);
const state = () => JSON.parse(execSync(`neon api /projects/${env.NEON_PROJECT_ID}/endpoints/ep-tiny-glade-bap1aoxc`, { env: { ...process.env, MSYS_NO_PATHCONV: "1" } }).toString()).endpoint;
let sql;
if (mode !== "none") {
  sql = postgres(mode === "pooled" ? env.NEON_DB_URL : env.NEON_DB_URL_DIRECT, { prepare: false, max: 1, idle_timeout: 0, max_lifetime: 0 });
  await sql`select 1`;
}
const t0 = Date.now(); const log = [];
console.log(`${mode}: last query at ${new Date(t0).toISOString()}`);
let prev;
while (Date.now() - t0 < minutes * 60e3) {
  const e = state(); const s = e.current_state;
  if (s !== prev) { log.push({ s, atMin: +((Date.now() - t0) / 60e3).toFixed(2), last_active: e.last_active }); console.log(JSON.stringify(log.at(-1))); prev = s; }
  await new Promise((r) => setTimeout(r, 15e3));
}
let alive = null;
if (sql) { try { await sql`select 1`; alive = "connection still usable"; } catch (e) { alive = "connection dropped: " + e.message; } await sql.end({ timeout: 1 }); }
console.log(JSON.stringify({ mode, transitions: log, after: alive }));
process.exit(0);
