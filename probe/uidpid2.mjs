// Do null auth.uid() results cluster on a backend's first request?
import { env } from "./env.mjs";
import { signIn } from "./signin.mjs";
const API = env.NEON_DATA_API_URL;
const a = await signIn("delivered+a@resend.dev", "https://orc-simulator.pages.dev/join/abc123");
const call = async () => (await fetch(`${API}/rpc/${process.argv[2] ?? "whoami_full"}`, { method: "POST", headers: { Authorization: `Bearer ${a.token}`, "content-type": "application/json" }, body: "{}" })).json();
const seen = new Map(); const t = { calls: 0, nulls: 0, nullOnFirstUseOfPid: 0, pids: 0, firstUses: 0 };
for (let round = 0; round < 6; round++) {
  const rs = await Promise.all(Array.from({ length: 60 }, call));
  for (const r of rs) { if (r.code) continue; t.calls++; const first = !seen.has(r.backend_pid); seen.set(r.backend_pid, (seen.get(r.backend_pid) ?? 0) + 1);
    if (first) t.firstUses++; if (r.uid == null) { t.nulls++; if (first) t.nullOnFirstUseOfPid++; } }
  await new Promise((r) => setTimeout(r, 1500));
}
t.pids = seen.size; console.log(JSON.stringify(t)); process.exit(0);
