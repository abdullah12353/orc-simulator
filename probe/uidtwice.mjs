import { env } from "./env.mjs";
import { signIn } from "./signin.mjs";
const a = await signIn("delivered+a@resend.dev", "https://orc-simulator.pages.dev/join/abc123");
const t = { calls: 0, firstNull: 0, secondNull: 0, bothNull: 0, jwtNull: 0, claimsEmpty: 0, claimsEmptyButUid: 0 };
for (let round = 0; round < 6; round++) {
  const rs = await Promise.all(Array.from({ length: 60 }, async () => (await fetch(`${env.NEON_DATA_API_URL}/rpc/whoami_twice`, { method: "POST", headers: { Authorization: `Bearer ${a.token}`, "content-type": "application/json" }, body: "{}" })).json()));
  for (const r of rs) { if (r.code) continue; t.calls++; if (!r.first) t.firstNull++; if (!r.second) t.secondNull++; if (!r.first && !r.second) t.bothNull++; if (!r.jwt) t.jwtNull++; if (!r.claims) { t.claimsEmpty++; if (r.uid) t.claimsEmptyButUid++; } }
  await new Promise((r) => setTimeout(r, 1500));
}
console.log(JSON.stringify(t)); process.exit(0);
