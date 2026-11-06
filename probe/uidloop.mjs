// Is auth.uid() inside a security definer function reliable? Interleave two users, 40 calls each, fresh and cold.
import { env } from "./env.mjs";
import { signIn } from "./signin.mjs";
const API = env.NEON_DATA_API_URL;
const a = await signIn("delivered+a@resend.dev", "https://orc-simulator.pages.dev/join/abc123");
const b = await signIn("delivered+b@resend.dev", "https://orc-simulator.pages.dev/join/abc123");
const call = async (u, fn) => (await (await fetch(`${API}/rpc/${fn}`, { method: "POST", headers: { Authorization: `Bearer ${u.token}`, "content-type": "application/json" }, body: "{}" })).json());
const tally = { ok: 0, nullUid: 0, wrongUid: 0, samples: [] };
await Promise.all(Array.from({ length: 80 }, async (_, i) => {
  const u = i % 2 ? a : b; const fn = i % 4 < 2 ? "whoami" : "whoami_plpgsql";
  const r = await call(u, fn);
  if (r.uid === u.claims.sub) tally.ok++; else { r.uid == null ? tally.nullUid++ : tally.wrongUid++; tally.samples.length < 6 && tally.samples.push({ fn, user: u === a ? "A" : "B", r: { uid: r.uid ?? null, code: r.code ?? null, claims: r.claims_setting === "" ? "empty" : r.claims_setting ? "set" : undefined } }); }
}));
const rg = await fetch(`${API}/intents?select=id&order=created_at`, { headers: { Authorization: `Bearer ${a.token}`, Prefer: "count=exact", Range: "5-9", "Range-Unit": "items" } });
console.log(JSON.stringify({ tally, range: { status: rg.status, contentRange: rg.headers.get("content-range"), rows: (await rg.json()).length } }, null, 1));
process.exit(0);
