// Magic-link sign-in end to end, without a mailbox: ask Neon Auth for a link, read link_url from the
// send.magic_link webhook (captured in probe_hooks), follow it, and mint a JWT from the session.
import postgres from "postgres";
import { env } from "./env.mjs";

const AUTH = env.NEON_AUTH_URL;
const ORIGIN = "https://orc-simulator.pages.dev";
const sql = postgres(env.NEON_DB_URL_DIRECT, { prepare: false, onnotice: () => {} });

export async function signIn(email, callbackURL) {
  const since = (await sql`select coalesce(max(id), 0)::int m from probe_hooks`)[0].m;
  const t0 = Date.now();
  const res = await fetch(`${AUTH}/sign-in/magic-link`, {
    method: "POST", headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email, callbackURL }),
  });
  const asked = { status: res.status, body: await res.text(), setCookie: res.headers.getSetCookie().map((c) => c.replace(/=[^;]*/, "=<v>")) };
  const jar = new Map();
  const keep = (r) => { for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); } };
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  keep(res);
  if (res.status !== 200) return { asked };
  let hook;
  for (let i = 0; i < 40 && !hook; i++) {
    [hook] = await sql`select body from probe_hooks where id > ${since} and body like ${'%"' + email + '"%'} and body like '%send.magic_link%' order by id limit 1`;
    if (!hook) await new Promise((r) => setTimeout(r, 250));
  }
  if (!hook) return { asked, error: "no webhook" };
  const webhookMs = Date.now() - t0;
  const ev = JSON.parse(hook.body);
  const verify = await fetch(ev.event_data.link_url, { redirect: "manual" });
  const location = verify.headers.get("location");
  const verifyCookies = verify.headers.getSetCookie().map((c) => c.replace(/=[^;]*/, "=<v>"));
  keep(verify);
  const verifier = location ? new URL(location).searchParams.get("neon_auth_session_verifier") : null;
  if (!verifier) return { asked, verifyStatus: verify.status, location, error: "no session verifier on the redirect" };
  // What @neon/auth's getSession does on the landing page: pass the verifier along.
  const gs = await fetch(`${AUTH}/get-session?neon_auth_session_verifier=${verifier}`, { headers: { cookie: cookieHeader(), origin: ORIGIN } });
  const sessionCookies = gs.headers.getSetCookie().map((c) => c.replace(/=[^;]*/, "=<v>"));
  keep(gs);
  const session = await gs.json().catch(() => null);
  const headerJwt = gs.headers.get("set-auth-jwt");
  const tok = await fetch(`${AUTH}/token`, { headers: { cookie: cookieHeader(), origin: ORIGIN } });
  const { token } = await tok.json().catch(() => ({}));
  const claims = token ? JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) : null;
  return { asked, webhookMs, linkHost: new URL(ev.event_data.link_url).host, verifyStatus: verify.status, location,
    verifyCookies, getSessionStatus: gs.status, sessionCookies, sessionUser: session?.user?.id ?? null, headerJwt: !!headerJwt, tokenStatus: tok.status, token, claims };
}

if (process.argv[1]?.endsWith("signin.mjs")) {
  const r = await signIn(process.argv[2] ?? "delivered+a@resend.dev", process.argv[3] ?? `${ORIGIN}/join/probe-token`);
  console.log(JSON.stringify({ ...r, token: r.token ? "<jwt>" : null }, null, 2));
  await sql.end();
}
