// Item 3 and 5: the Data API under two real Neon Auth users, through @neon/postgrest-js
// (Supabase's postgrest-js underneath), plus raw fetches where the header matters.
import postgres from "postgres";
import { NeonPostgrestClient } from "@neon/postgrest-js";
import { env } from "./env.mjs";
import { signIn } from "./signin.mjs";

const sql = postgres(env.NEON_DB_URL_DIRECT, { prepare: false, onnotice: () => {} });
const API = env.NEON_DATA_API_URL;
const client = (token) => new NeonPostgrestClient({ dataApiUrl: API, options: { global: {
  fetch: (url, init = {}) => { const h = new Headers(init.headers); if (token) h.set("Authorization", `Bearer ${token}`); return fetch(url, { ...init, headers: h }); } } } });
const out = {};
const show = (k, r) => { out[k] = r && "error" in r ? { data: r.data, count: r.count, status: r.status, error: r.error && { code: r.error.code, message: r.error.message } } : r; };

const a = await signIn("delivered+a@resend.dev", "https://orc-simulator.pages.dev/join/abc123");
const b = await signIn("delivered+b@resend.dev", "https://orc-simulator.pages.dev/join/abc123");
const ua = a.claims.sub, ub = b.claims.sub;

// Seed: world W1 with A and two NPC-ish players (A's only), world W2 with B. 12 intents for A for range().
await sql`truncate intents, invites, players, worlds cascade`;
const [w1] = await sql`insert into worlds (name) values ('Grimbog') returning id`;
const [w2] = await sql`insert into worlds (name) values ('Other Place') returning id`;
const [pa] = await sql`insert into players (world_id, user_id, name) values (${w1.id}, ${ua}, 'Ada') returning id`;
await sql`insert into players (world_id, user_id, name) values (${w2.id}, ${ub}, 'Bob')`;
await sql`insert into invites (token, world_id, expires_at) values ('tok-open', ${w1.id}, now() + interval '1 day')`;
for (let i = 0; i < 12; i++) await sql`insert into intents (id, world_id, player_id, kind, status) values (gen_random_uuid(), ${w1.id}, ${pa.id}, 'rumour', ${i < 2 ? "queued" : "landed"})`;

const A = client(a.token), B = client(b.token), anon = client(null);
show("A.invite_info", await A.rpc("invite_info", { token: "tok-open" }));
show("A.invite_info.single", await A.rpc("invite_info", { token: "nope" }).single());
show("anon(no JWT).invite_info", await anon.rpc("invite_info", { token: "tok-open" }));
show("A.whoami(sql definer)", await A.rpc("whoami"));
show("A.whoami_plpgsql(definer)", await A.rpc("whoami_plpgsql"));
show("A.whoami_invoker", await A.rpc("whoami_invoker"));
const iid = crypto.randomUUID();
show("A.submit_intent", await A.rpc("submit_intent", { id: iid, world_id: w1.id, kind: "dare", payload: { x: 1 } }));
show("A.submit_intent.again(idempotent)", await A.rpc("submit_intent", { id: iid, world_id: w1.id, kind: "dare", payload: { x: 1 } }));
show("B.submit_intent.into_W1", await B.rpc("submit_intent", { id: crypto.randomUUID(), world_id: w1.id, kind: "dare", payload: {} }));
show("A.roster(view)", await A.from("roster").select("*"));
show("B.roster(view)", await B.from("roster").select("*"));
show("A.count_head", await A.from("intents").select("id", { count: "exact", head: true }).eq("player_id", pa.id).eq("status", "queued"));
show("B.count_head(A's intents)", await B.from("intents").select("id", { count: "exact", head: true }).eq("player_id", pa.id));
const rg = await A.from("intents").select("id, created_at", { count: "exact" }).order("created_at").range(5, 9);
show("A.range(5,9)", { status: rg.status, rows: rg.data?.length, count: rg.count, error: rg.error?.message });
// Raw: does the server answer HEAD + Prefer: count=exact with Content-Range?
const raw = await fetch(`${API}/intents?select=id&player_id=eq.${pa.id}`, { method: "HEAD", headers: { Authorization: `Bearer ${a.token}`, Prefer: "count=exact", Range: "0-4", "Range-Unit": "items" } });
out["raw.HEAD"] = { status: raw.status, contentRange: raw.headers.get("content-range") };
const cors = await fetch(`${API}/roster?select=*`, { method: "OPTIONS", headers: { Origin: "https://orc-simulator.pages.dev", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization,content-type,prefer,range" } });
out["CORS preflight"] = { status: cors.status, allowOrigin: cors.headers.get("access-control-allow-origin"), allowHeaders: cors.headers.get("access-control-allow-headers"), expose: cors.headers.get("access-control-expose-headers") };
console.log(JSON.stringify(out, null, 2));
await sql.end();
process.exit(0);
