// Does the fresh-connection null also hit RLS policies? A should always see exactly 1 row of probe_inline.
import { env } from "./env.mjs";
import { signIn } from "./signin.mjs";
const API = env.NEON_DATA_API_URL;
const a = await signIn("delivered+a@resend.dev", "https://orc-simulator.pages.dev/join/abc123");
const t = { calls: 0, one: 0, empty: 0, other: 0 };
for (let round = 0; round < 6; round++) {
  const rs = await Promise.all(Array.from({ length: 60 }, async () => (await fetch(`${API}/probe_inline?select=note`, { headers: { Authorization: `Bearer ${a.token}` } })).json()));
  for (const r of rs) { t.calls++; Array.isArray(r) ? (r.length === 1 ? t.one++ : r.length === 0 ? t.empty++ : t.other++) : (t.other++, (t.o ??= {})[JSON.stringify(r).slice(0,120)] = 1); }
  await new Promise((r) => setTimeout(r, 1500));
}
console.log(JSON.stringify(t)); process.exit(0);
