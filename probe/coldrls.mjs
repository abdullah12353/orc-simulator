// Cold compute: does a policy that calls a security definer helper (my_player) silently hide rows?
import { env } from "./env.mjs";
import { signIn } from "./signin.mjs";
const path = process.argv[2];
const a = await signIn("delivered+a@resend.dev", "https://orc-simulator.pages.dev/join/abc123");
const t = { path, rows1: 0, rows0: 0, err: {} };
for (let k = 0; k < 4; k++) {
  const rs = await Promise.all(Array.from({ length: 60 }, async () => (await fetch(`${env.NEON_DATA_API_URL}/${path}`, { method: path.startsWith("rpc/") ? "POST" : "GET", headers: { Authorization: `Bearer ${a.token}`, "content-type": "application/json" }, body: path.startsWith("rpc/") ? process.argv[3] ?? "{}" : undefined })).json()));
  for (const r of rs) { if (!Array.isArray(r) && r.code) t.err[r.code] = (t.err[r.code] ?? 0) + 1; else if (Array.isArray(r)) (r.length ? t.rows1++ : t.rows0++); else t.other = r; }
}
console.log(JSON.stringify(t)); process.exit(0);
