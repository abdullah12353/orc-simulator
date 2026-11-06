// Throwaway probe for #65 item 3: what Neon's API says about usage on Free, and whether reading it wakes compute.
// Auth: the neon CLI's OAuth token (~/.config/neon/credentials.json; run `neon me` first to refresh it).
// Project id: NEON_PROJECT_ID from the main checkout's .env.deploy. Never prints secrets.
//
//   node neon-api.mjs state            endpoint state only
//   node neon-api.mjs usage            project consumption fields + endpoint state before/after
//   node neon-api.mjs consumption      the consumption_history endpoints (plan-gated?)
//   node neon-api.mjs sample <file>    append one {at, endpoint state, usage fields} JSON line to <file>
import { readFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ENV_DEPLOY = process.env.ENV_DEPLOY ?? "C:/Users/abdul/.t3/projects/orc-simulator/.env.deploy";
const env = Object.fromEntries(
  readFileSync(ENV_DEPLOY, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
const PROJECT = env.NEON_PROJECT_ID;
const ORG = env.NEON_ORG_ID;
const token = JSON.parse(readFileSync(join(homedir(), ".config/neon/credentials.json"), "utf8")).access_token;
const API = "https://console.neon.tech/api/v2";

async function get(path) {
  const r = await fetch(API + path, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}

const USAGE_FIELDS = [
  "consumption_period_start", "consumption_period_end", "quota_reset_at",
  "active_time_seconds", "compute_time_seconds", "cpu_used_sec",
  "written_data_bytes", "data_transfer_bytes", "data_storage_bytes_hour", "synthetic_storage_size",
  "compute_last_active_at",
];

async function endpointState() {
  const { status, body } = await get(`/projects/${PROJECT}/endpoints`);
  if (status !== 200) return { status, body };
  return body.endpoints.map((e) => ({
    id: e.id, current_state: e.current_state, pending_state: e.pending_state,
    last_active: e.last_active, suspend_timeout_seconds: e.suspend_timeout_seconds,
    autoscaling: [e.autoscaling_limit_min_cu, e.autoscaling_limit_max_cu],
  }));
}

async function usage() {
  const { status, body } = await get(`/projects/${PROJECT}`);
  if (status !== 200) return { status, body };
  const p = body.project;
  const out = Object.fromEntries(USAGE_FIELDS.filter((k) => k in p).map((k) => [k, p[k]]));
  out.plan = p.owner?.subscription_type ?? p.subscription_type;
  out.cu_hours_from_compute_time = p.compute_time_seconds != null ? +(p.compute_time_seconds / 3600).toFixed(4) : null;
  return out;
}

const cmd = process.argv[2] ?? "usage";
if (cmd === "state") {
  console.log(JSON.stringify(await endpointState(), null, 1));
} else if (cmd === "usage") {
  const before = await endpointState();
  const u = await usage();
  const b = await get(`/projects/${PROJECT}/branches`);
  const branches = b.status === 200 ? b.body.branches.map((x) => ({
    id: x.id, name: x.name, compute_time_seconds: x.compute_time_seconds, active_time_seconds: x.active_time_seconds,
    cpu_used_sec: x.cpu_used_sec, written_data_bytes: x.written_data_bytes, logical_size: x.logical_size,
  })) : b;
  const after = await endpointState();
  console.log(JSON.stringify({ at: new Date().toISOString(), endpoint_before: before, project_usage: u, branches, endpoint_after: after }, null, 1));
} else if (cmd === "consumption") {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const to = new Date(Math.ceil(now.getTime() / 3600e3) * 3600e3).toISOString();
  const q = `from=${from}&to=${to}&granularity=daily`;
  for (const path of [
    `/consumption_history/account?${q}&org_id=${ORG}`,
    `/consumption_history/projects?${q}&org_id=${ORG}&project_ids=${PROJECT}`,
    `/consumption_history/v2/projects?${q}&org_id=${ORG}&project_ids=${PROJECT}&metrics=compute_unit_seconds`,
  ]) {
    const r = await get(path);
    console.log("GET", path.replace(ORG, "<org>").replace(PROJECT, "<project>"), "->", r.status);
    console.log(JSON.stringify(r.body, null, 1).slice(0, 1500));
  }
} else if (cmd === "sample") {
  const line = { at: new Date().toISOString(), endpoint: await endpointState(), usage: await usage() };
  appendFileSync(process.argv[3], JSON.stringify(line) + "\n");
  console.log(JSON.stringify(line));
}
