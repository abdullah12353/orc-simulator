// How often does auth.uid() come back null over the Data API? N calls per mode, two users.
import { env } from "./env.mjs";
import { signIn } from "./signin.mjs";
const API = env.NEON_DATA_API_URL;
const N = Number(process.argv[2] ?? 100);
const a = await signIn("delivered+a@resend.dev", "https://orc-simulator.pages.dev/join/abc123");
const b = await signIn("delivered+b@resend.dev", "https://orc-simulator.pages.dev/join/abc123");
const call = async (u) => (await fetch(`${API}/rpc/whoami_full`, { method: "POST", headers: { Authorization: `Bearer ${u.token}`, "content-type": "application/json" }, body: "{}" })).json();
const run = async (mode) => {
  const t = { mode, ok: 0, nullUid: 0, wrong: 0, err: 0, nullSamples: [] };
  const one = async (i) => { const u = i % 2 ? a : b; const r = await call(u);
    if (r.code) { t.err++; (t.errs ??= {})[r.code + ": " + String(r.message).slice(0, 90)] = ((t.errs ?? {})[r.code + ": " + String(r.message).slice(0, 90)] ?? 0) + 1; } else if (r.uid === u.claims.sub) t.ok++; else if (r.uid == null) { t.nullUid++; t.nullSamples.length < 3 && t.nullSamples.push({ role: r.role_setting, claims: r.claims ? "set" : "empty", pid: r.backend_pid }); } else t.wrong++; };
  if (mode === "sequential") for (let i = 0; i < N; i++) await one(i); else await Promise.all(Array.from({ length: N }, (_, i) => one(i)));
  return t;
};
console.log(JSON.stringify(await run("sequential")));
console.log(JSON.stringify(await run("concurrent")));
process.exit(0);
