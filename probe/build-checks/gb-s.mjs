// Throwaway probe for #65 item 2: read the Durable Object's duration from Cloudflare's GraphQL analytics.
// Token: `wrangler auth token` (kept in memory, never printed). Account: CF_ACCOUNT_ID from .env.deploy.
//   node gb-s.mjs <fromISO> <toISO> [query=periodic|invocations|introspect <Type>]
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const env = Object.fromEntries(
  readFileSync("C:/Users/abdul/.t3/projects/orc-simulator/.env.deploy", "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
const raw = execSync("npx wrangler auth token --json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
let token;
try { const j = JSON.parse(raw); token = j.token ?? j.oauth_token ?? j.value; } catch { token = raw.trim().split(/\s+/).pop(); }

async function gql(query, variables) {
  const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  return r.json();
}

const [from, to, what = "periodic", typeName] = process.argv.slice(2);
const vars = { account: process.env.CF_ACCOUNT ?? env.CF_ACCOUNT_ID, from, to };

if (what === "introspect") {
  const q = `query($n:String!){ __type(name:$n){ name fields { name type { name kind ofType { name kind } } } inputFields { name type { name kind ofType { name } } } } }`;
  console.log(JSON.stringify(await gql(q, { n: typeName }), null, 1));
} else if (what === "periodic") {
  // activeTime is in microseconds; duration is billed at 128 MB, so GB-s = activeTime/1e6 * 0.125.
  const q = `query($account:String!,$from:Time!,$to:Time!){ viewer { accounts(filter:{accountTag:$account}) {
    durableObjectsPeriodicGroups(limit:10000, filter:{datetimeMinute_geq:$from, datetimeMinute_leq:$to},
      orderBy:[datetimeMinute_ASC]) {
      dimensions { datetimeMinute namespaceId objectId }
      sum { activeTime duration cpuTime rowsWritten inboundWebsocketMsgCount outboundWebsocketMsgCount subrequests }
      max { activeWebsocketConnections }
    } } } }`;
  console.log(JSON.stringify(await gql(q, vars)));
} else if (what === "invocations") {
  const q = `query($account:String!,$from:Time!,$to:Time!){ viewer { accounts(filter:{accountTag:$account}) {
    durableObjectsInvocationsAdaptiveGroups(limit:10000, filter:{datetime_geq:$from, datetime_leq:$to}) {
      dimensions { scriptName namespaceId objectId }
      sum { requests wallTime responseBodySize errors }
    } } } }`;
  console.log(JSON.stringify(await gql(q, vars)));
}
