// Item 5, fix 1: can a client choose its uid by passing _init? Expect the caller's own uid back regardless.
import { env } from "./env.mjs";
import { signIn } from "./signin.mjs";
const a = await signIn("delivered+a@resend.dev", "https://orc-simulator.pages.dev/join/abc123");
const r = await (await fetch(`${env.NEON_DATA_API_URL}/rpc/whoami_init`, { method: "POST", headers: { Authorization: `Bearer ${a.token}`, "content-type": "application/json" },
  body: JSON.stringify({ _init: "00000000-0000-0000-0000-000000000001" }) })).json();
console.log(JSON.stringify({ returned: r.uid, passed: r.init, self: a.claims.sub, spoofed: r.uid !== a.claims.sub }));
process.exit(0);
