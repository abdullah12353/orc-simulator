// Sets up (or checks) everything ORC NONSENSE runs on, from the values in `.env.deploy` (#62 item 2, #71).
// Re-runnable: each step reads what's there first and changes only what differs, so a second run in a row
// prints only `=` lines and "no changes".
//
//   node scripts/provision.mjs [--env .env.deploy] [--dev-env .env.local] [--dev-vars apps/worker/.dev.vars] [--smtp]
//   npm run provision
//
// Needs the Neon CLI (`neon`, logged in) and Wrangler (logged in): `scripts/setup-deploy.sh` walks a human
// through both, the Gmail app password and the Groq key. In order:
//
//   Cloudflare   wrangler's account (checked against CF_ACCOUNT_ID), the Pages project
//   Neon         the project (NEON_PROJECT_NAME, default orc-nonsense, in NEON_REGION, default AWS London),
//                its default branch (production) and a persistent `dev` branch. On each: Neon Auth (magic
//                links, 60-min expiry; trusted domains <pages>.pages.dev, *.<pages>.pages.dev and localhost;
//                email-password on `dev` only), the Data API, the migrations (scripts/migrate.mjs) and then
//                `neon data-api refresh-schema`. Gmail SMTP as "The Gutter Herald" on production. A
//                project-scoped API key for the Worker's usage guard (#70).
//   Worker       the KV world list, then the Worker with its vars and secrets (#62's table), deployed only
//                when its bundle, config or secrets changed (tracked in the version's tag)
//   Pages        the PWA built with the production values, deployed only when the build changed
//   Files        what it learned goes back into the env file (the NEON_*, WORKER_URL, PAGES_URL, VAPID keys),
//                and the `dev` branch's values into .env.local (for `npm run web:env`) and
//                apps/worker/.dev.vars (for `npm run dev:worker` and `npm run smoke`)
//
// Names come from the env file, with these defaults: NEON_PROJECT_NAME=orc-nonsense,
// NEON_REGION=aws-eu-west-2, WORKER_NAME=orc-worker, KV_NAMESPACE=orc-worlds, PAGES_PROJECT=orc-simulator.
// A throwaway copy (`--env .env.deploy.probe` with -probe names) provisions a full second stack to test on.
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnv, updateEnv } from './env-file.mjs';
import { migrate, MIGRATIONS_DIR } from './migrate.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORKER_DIR = join(ROOT, 'apps/worker');
const WEB_DIST = join(ROOT, 'apps/web/dist');
const WRANGLER = join(ROOT, 'node_modules/wrangler/bin/wrangler.js');
const DB = 'neondb';
const SENDER_NAME = 'The Gutter Herald';
const MAGIC_LINK_MINUTES = 60;
const GMAIL_SMTP = { host: 'smtp.gmail.com', port: 465 };
/** What `.env.deploy` drops (#62 item 4): the Supabase, Resend, REST-AI and clock values. */
const LEGACY = /^(SUPABASE_.*|RESEND_API_KEY|EMAIL_FROM|CF_AI_TOKEN|TICK_.*|ORC_DB_URL)$/;
/** What this script writes about the Neon project, dropped when they belong to another project. */
const NEON_KEYS = ['NEON_PROJECT_ID', 'NEON_DB_URL', 'NEON_DB_URL_DIRECT', 'NEON_AUTH_URL', 'NEON_AUTH_JWKS_URL', 'NEON_DATA_API_URL', 'NEON_GUARD_API_KEY'];

// ---- arguments ----

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\nimport ')[0].replaceAll(/^\/\/ ?/gm, ''));
  process.exit(0);
}
const option = (name, fallback) => {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  if (!argv[i + 1]) throw new Error(`${name} needs a value`);
  return resolve(argv[i + 1]);
};
const ENV_FILE = option('--env', join(ROOT, '.env.deploy'));
const DEV_ENV = option('--dev-env', join(ROOT, '.env.local'));
const DEV_VARS = option('--dev-vars', join(WORKER_DIR, '.dev.vars'));
const FORCE_SMTP = argv.includes('--smtp');

// ---- output ----

let changes = 0;
const section = (title) => console.log(`\n${title}`);
const same = (line) => console.log(`  = ${line}`);
const did = (line) => {
  changes++;
  console.log(`  + ${line}`);
};
const warn = (line) => console.log(`  ! ${line}`);
const fail = (line) => {
  console.error(`\n✗ ${line}`);
  process.exit(1);
};

// ---- subprocesses ----

const TMP = mkdtempSync(join(tmpdir(), 'orc-provision-'));
process.on('exit', () => rmSync(TMP, { recursive: true, force: true }));
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Runs a command and returns its output. On Windows, `neon` and `npm` are .cmd shims, which only a shell
 * runs, so their arguments are quoted for cmd.exe (secrets never go on a command line: they go in files).
 */
function run(cmd, args, { cwd = TMP, env = process.env, timeout = 120_000, check = true } = {}) {
  let shell = false;
  let list = args;
  if (process.platform === 'win32' && cmd !== process.execPath) {
    for (const a of args) if (/["%!^&|<>\r\n]/.test(a)) throw new Error(`can't pass ${JSON.stringify(a)} through cmd.exe`);
    shell = true;
    list = args.map((a) => `"${a}"`);
  }
  const r = spawnSync(cmd, list, { cwd, env, timeout, shell, encoding: 'utf8', maxBuffer: 256 << 20, windowsHide: true });
  if (r.error) throw new Error(`${cmd} ${args.slice(0, 2).join(' ')}: ${r.error.message}`);
  if (check && r.status !== 0) {
    throw new Error(`${cmd === process.execPath ? 'wrangler' : cmd} ${args.slice(cmd === process.execPath ? 1 : 0, 4).join(' ')} failed (exit ${r.status}):\n${`${r.stderr}\n${r.stdout}`.trim()}`);
  }
  return r;
}

/** The first JSON value in a command's output (wrangler can print a banner first). */
function json(text) {
  const start = text.search(/[[{]/);
  if (start === -1) throw new Error(`expected JSON, got: ${text.slice(0, 300)}`);
  return JSON.parse(text.slice(start));
}

/**
 * Neon's API through the CLI (`neon api`, so its login is used). Retries while another operation holds
 * the project (423), which happens for a while after creating a project, a branch or Neon Auth.
 */
function neonApi(method, path, { body, query = {} } = {}) {
  const args = ['api', path, '-X', method, '-i'];
  for (const [k, v] of Object.entries(query)) args.push('-Q', `${k}=${v}`);
  const bodyFile = body === undefined ? null : join(TMP, `body-${randomUUID()}.json`);
  if (bodyFile) {
    writeFileSync(bodyFile, JSON.stringify(body), { mode: 0o600 });
    args.push('-d', `@${bodyFile}`);
  }
  try {
    for (let attempt = 1; ; attempt++) {
      const r = run('neon', args, { check: false });
      const status = Number(/^HTTP (\d{3})/m.exec(r.stdout)?.[1]);
      if (!status) throw new Error(`neon api ${method} ${path}: ${`${r.stderr}\n${r.stdout}`.trim()}`);
      const text = r.stdout.slice(r.stdout.search(/\r?\n\r?\n/)).trim();
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
      if (status === 423 && attempt < 60) {
        sleep(3000);
        continue;
      }
      return { status, body: parsed };
    }
  } finally {
    if (bodyFile) rmSync(bodyFile, { force: true });
  }
}

/** A Neon API call that must succeed. */
function api(method, path, options) {
  const r = neonApi(method, path, options);
  if (r.status < 200 || r.status > 299) throw new Error(`Neon ${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

let cfEnv = process.env;
// From the repo root by default, never the temp dir: Wrangler takes the nearest package.json's folder as
// the project and writes `.wrangler/tmp` there. Above the temp dir that can be the home folder, and a
// `~/.wrangler` makes Wrangler look for its login there instead, logging it out mid-run.
const wrangler = (args, options = {}) => run(process.execPath, [WRANGLER, ...args], { cwd: ROOT, env: cfEnv, ...options });

// ---- small helpers ----

const sha256 = (...parts) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p).update('\0');
  return h.digest('hex');
};

/** One hash over the files under `dir` (paths and contents) that `skip` doesn't leave out. */
function hashDir(dir, skip = () => false) {
  const h = createHash('sha256');
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (!skip(name)) h.update(relative(dir, p).replaceAll('\\', '/')).update('\0').update(readFileSync(p)).update('\0');
    }
  };
  walk(dir);
  return h.digest('hex');
}

/** wrangler.jsonc → an object: // and /* comments and trailing commas go. */
function parseJsonc(text) {
  let out = '';
  for (let i = 0, inString = false; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i];
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
    } else {
      out += c;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

async function getJson(url, headers) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  return { ok: res.ok, status: res.status, body: res.ok ? await res.json() : await res.text() };
}

// ---- the env file ----

if (!existsSync(ENV_FILE)) fail(`No ${ENV_FILE}. Run the deploy wizard first: bash scripts/setup-deploy.sh`);
const cur = readEnv(ENV_FILE);
const envName = basename(ENV_FILE);

/** Writes values back to the env file at once, so a failed run keeps what it made (an API key, say). */
function save(updates) {
  const written = updateEnv(ENV_FILE, updates);
  for (const [k, v] of Object.entries(updates)) {
    if (v === null) delete cur[k];
    else cur[k] = v;
  }
  if (written.length) did(`${envName}: ${written.map((k) => (updates[k] === null ? `-${k}` : k)).join(', ')}`);
}

const names = {
  neonProject: cur.NEON_PROJECT_NAME || 'orc-nonsense',
  region: cur.NEON_REGION || 'aws-eu-west-2',
  worker: cur.WORKER_NAME || 'orc-worker',
  kv: cur.KV_NAMESPACE || 'orc-worlds',
  pages: cur.PAGES_PROJECT || 'orc-simulator',
};
console.log(`provision from ${ENV_FILE}`);
console.log(`  Neon ${names.neonProject} (${names.region}) · Worker ${names.worker} · KV ${names.kv} · Pages ${names.pages}`);

section('Env file');
{
  const legacy = Object.keys(cur).filter((k) => LEGACY.test(k));
  if (legacy.length) save(Object.fromEntries(legacy.map((k) => [k, null])));
  else same('no Supabase, Resend or clock values left');

  // The Web Push pair: made once and kept (a new pair would break every device's opt-in).
  if (!cur.VAPID_PUBLIC_KEY || !cur.VAPID_PRIVATE_KEY) {
    const jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' });
    const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
    save({ VAPID_PUBLIC_KEY: pub.toString('base64url'), VAPID_PRIVATE_KEY: jwk.d });
  } else same('VAPID keys');
  if (!cur.VAPID_SUBJECT) {
    if (!cur.GMAIL_USER) fail(`${envName} needs VAPID_SUBJECT (mailto:you@example.com) or GMAIL_USER for push services' contact address.`);
    save({ VAPID_SUBJECT: `mailto:${cur.GMAIL_USER}` });
  } else same(`VAPID_SUBJECT ${cur.VAPID_SUBJECT}`);
  if (!cur.GROQ_API_KEY) warn('GROQ_API_KEY is blank: narration has no fallback when Workers AI is down or out of Neurons.');
}

// ---- Cloudflare: the account and the Pages project ----

section('Cloudflare');
const who = json(wrangler(['whoami', '--json']).stdout);
const accountIds = (who.accounts ?? []).map((a) => a.id);
let account = cur.CF_ACCOUNT_ID;
if (account && !accountIds.includes(account)) {
  fail(`CF_ACCOUNT_ID ${account} isn't an account wrangler is logged into (${accountIds.join(', ') || 'none'}). Run \`npx wrangler login\` as the right user, or fix ${envName}.`);
}
if (!account) {
  if (accountIds.length !== 1) fail(`wrangler sees ${accountIds.length} accounts; set CF_ACCOUNT_ID in ${envName}.`);
  account = accountIds[0];
  save({ CF_ACCOUNT_ID: account });
}
same(`wrangler is logged into account ${account} (${who.email})`);
// Wrangler's own environment, without the Worker's secret names: `--secrets-file` lets the environment win.
cfEnv = { ...process.env, CLOUDFLARE_ACCOUNT_ID: account, WRANGLER_SEND_METRICS: 'false' };
for (const k of ['NEON_DB_URL', 'GROQ_API_KEY', 'VAPID_PRIVATE_KEY', 'NEON_API_KEY']) delete cfEnv[k];

const pagesProject = () => json(wrangler(['pages', 'project', 'list', '--json']).stdout).find((p) => p['Project Name'] === names.pages);
let pages = pagesProject();
if (!pages) {
  // --force: run by a coding agent, wrangler 4.158 makes a new project a Workers-with-assets project
  // instead. The site is a Pages project on <name>.pages.dev (#62, and Neon Auth's trusted domains), the
  // same as a human's run gets, so this opts out. An existing project is never delegated.
  wrangler(['pages', 'project', 'create', names.pages, '--production-branch', 'main', '--force']);
  pages = pagesProject();
  if (!pages) fail(`created Pages project ${names.pages}, but it isn't listed`);
  did(`Pages project ${names.pages}`);
} else same(`Pages project ${names.pages}`);
const pagesHost = String(pages['Project Domains'])
  .split(/[,\s]+/)
  .find((d) => d.endsWith('.pages.dev'));
if (!pagesHost) fail(`Pages project ${names.pages} has no pages.dev domain: ${pages['Project Domains']}`);
const PAGES_URL = `https://${pagesHost}`;

// ---- Neon ----

section('Neon');
let orgId = cur.NEON_ORG_ID;
if (!orgId) {
  const orgs = json(run('neon', ['orgs', 'list', '-o', 'json']).stdout);
  if (orgs.length !== 1) fail(`Neon shows ${orgs.length} organisations; set NEON_ORG_ID in ${envName}.`);
  orgId = orgs[0].id;
  save({ NEON_ORG_ID: orgId });
}

let project = null;
if (cur.NEON_PROJECT_ID) {
  const r = neonApi('GET', `/projects/${cur.NEON_PROJECT_ID}`);
  if (r.status === 200 && r.body.project.name === names.neonProject) project = r.body.project;
  else {
    const what = r.status === 200 ? `"${r.body.project.name}"` : `gone (${r.status})`;
    warn(`NEON_PROJECT_ID ${cur.NEON_PROJECT_ID} is ${what}, not ${names.neonProject}: dropping its NEON_* values from ${envName} (that project is left alone).`);
    save(Object.fromEntries(NEON_KEYS.map((k) => [k, null])));
  }
}
if (!project) {
  const matches = json(run('neon', ['projects', 'list', '--org-id', orgId, '-o', 'json']).stdout).filter((p) => p.name === names.neonProject);
  if (matches.length > 1) fail(`Neon has ${matches.length} projects named ${names.neonProject}; set NEON_PROJECT_ID in ${envName}.`);
  project = matches[0] ?? null;
}
if (!project) {
  project = api('POST', '/projects', { body: { project: { name: names.neonProject, region_id: names.region, pg_version: 18, org_id: orgId } } }).project;
  did(`project ${names.neonProject} (${project.id}) in ${project.region_id}`);
} else same(`project ${names.neonProject} (${project.id}) in ${project.region_id}`);
if (project.region_id !== names.region) warn(`the project is in ${project.region_id}, not ${names.region}. A region can't change; delete it by hand to move.`);
const pid = project.id;
save({ NEON_PROJECT_ID: pid });

const branches = api('GET', `/projects/${pid}/branches`).branches;
const main = branches.find((b) => b.default);
if (!main) fail(`project ${pid} has no default branch`);
let dev = branches.find((b) => b.name === 'dev');
if (!dev) {
  dev = api('POST', `/projects/${pid}/branches`, { body: { branch: { name: 'dev', parent_id: main.id }, endpoints: [{ type: 'read_write' }] } }).branch;
  did(`branch dev (${dev.id}), from ${main.name}, no expiry`);
} else same(`branches ${main.name} (production, ${main.id}) and dev (${dev.id})`);
if (dev.expires_at) warn(`branch dev expires at ${dev.expires_at}; #61 wants it persistent.`);

const trustedDomains = [PAGES_URL, `https://*.${pagesHost}`];
const migrationCount = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).length;

/** Neon Auth, the Data API and the schema on one branch. Returns the branch's URLs. */
async function setUpBranch(branch, { production }) {
  const base = `/projects/${pid}/branches/${branch.id}`;
  const on = (line) => `${branch.name}: ${line}`;

  let auth = neonApi('GET', `${base}/auth`);
  if (auth.status === 404) {
    api('POST', `${base}/auth`, { body: { auth_provider: 'better_auth', database_name: DB } });
    auth = { status: 200, body: api('GET', `${base}/auth`) };
    did(on('Neon Auth enabled'));
  } else if (auth.status === 200) same(on('Neon Auth'));
  else throw new Error(`Neon Auth on ${branch.name}: ${auth.status} ${JSON.stringify(auth.body)}`);

  // After Neon Auth, so the Data API trusts its JWTs and creates the `auth` schema and roles the
  // migrations' RLS policies use.
  let dataApi = neonApi('GET', `${base}/data-api/${DB}`);
  let dataApiNew = false;
  if (dataApi.status === 404) {
    api('POST', `${base}/data-api/${DB}`, { body: { auth_provider: 'neon_auth' } });
    dataApi = { status: 200, body: api('GET', `${base}/data-api/${DB}`) };
    dataApiNew = true;
    did(on('Data API enabled'));
  } else if (dataApi.status === 200) same(on('Data API'));
  else throw new Error(`Data API on ${branch.name}: ${dataApi.status} ${JSON.stringify(dataApi.body)}`);

  const plugins = api('GET', `${base}/auth/plugins`);
  if (plugins.magic_link?.enabled !== true || plugins.magic_link?.expires_in !== MAGIC_LINK_MINUTES) {
    api('PATCH', `${base}/auth/plugins/magic-link`, { body: { enabled: true, expires_in: MAGIC_LINK_MINUTES } });
    did(on(`magic links on, ${MAGIC_LINK_MINUTES}-min expiry`));
  } else same(on(`magic links on, ${MAGIC_LINK_MINUTES}-min expiry`));

  // Email and password: the smoke test's way in, on `dev` only (#61 item 4).
  const emailPassword = !production;
  if (plugins.email_and_password?.enabled !== emailPassword) {
    api('PATCH', `${base}/auth/email_and_password`, { body: { enabled: emailPassword } });
    did(on(`email-password ${emailPassword ? 'on' : 'off'}`));
  } else same(on(`email-password ${emailPassword ? 'on' : 'off'}`));

  if (plugins.allow_localhost !== true) {
    api('PATCH', `${base}/auth/allow_localhost`, { body: { allow_localhost: true } });
    did(on('localhost trusted'));
  }
  const listed = api('GET', `${base}/auth/domains`);
  const have = new Set((Array.isArray(listed) ? listed : (listed.domains ?? [])).map((d) => d.domain));
  const added = trustedDomains.filter((d) => !have.has(d));
  for (const domain of added) api('POST', `${base}/auth/domains`, { body: { domain, auth_provider: 'better_auth' } });
  if (added.length) did(on(`trusted ${added.join(', ')}`));
  if (plugins.allow_localhost === true && !added.length) same(on(`trusted localhost, ${trustedDomains.join(', ')}`));

  if (production) setUpSmtp(base, on);

  const role = (api('GET', `${base}/roles`).roles ?? []).find((r) => !r.protected)?.name;
  if (!role) throw new Error(`no owner role on ${branch.name}`);
  const uri = (pooled) => api('GET', `/projects/${pid}/connection_uri`, { query: { branch_id: branch.id, database_name: DB, role_name: role, pooled } }).uri;
  const pooled = uri(true);
  const direct = uri(false);

  // A new compute can take a moment to answer.
  let applied;
  for (let attempt = 1; ; attempt++) {
    try {
      applied = await migrate(direct, { log: () => {} });
      break;
    } catch (e) {
      if (attempt >= 4 || !/ECONN|ENOTFOUND|EAI_AGAIN|timeout|terminat/i.test(String(e?.message ?? e))) throw e;
      sleep(5000);
    }
  }
  if (applied.length) did(on(`applied ${applied.length} migration(s), ${applied[0]} … ${applied.at(-1)}`));
  else same(on(`schema up to date (${migrationCount} migrations)`));
  if (applied.length || dataApiNew) {
    run('neon', ['data-api', 'refresh-schema', '--project-id', pid, '--branch', branch.id, '--database', DB]);
    console.log(`  + ${on('Data API schema cache refreshed')}`);
  }

  return {
    authUrl: auth.body.base_url,
    jwksUrl: auth.body.jwks_url,
    issuer: new URL(auth.body.base_url).origin,
    dataApiUrl: dataApi.body.url,
    pooled,
    direct,
  };
}

/** Gmail SMTP for production's magic links, sent as "The Gutter Herald" (#52, #62). */
function setUpSmtp(base, on) {
  const current = api('GET', `${base}/auth/email_provider`);
  const user = cur.GMAIL_USER?.trim();
  const password = cur.GMAIL_APP_PASSWORD?.replaceAll(/\s+/g, '');
  if (!user || !password) {
    if (current.type === 'standard') warn(on(`GMAIL_USER / GMAIL_APP_PASSWORD are blank; leaving the SMTP already set (${current.host}, ${current.sender_email}).`));
    else {
      warn(on(`GMAIL_USER / GMAIL_APP_PASSWORD are blank, so magic links go out from Neon's shared sender (${current.sender_email ?? 'auth@mail.myneon.app'}, "${current.sender_name ?? 'Neon Auth'}"), not "${SENDER_NAME}".`));
      warn('  The shared sender is for testing: fill both in (bash scripts/setup-deploy.sh) and re-run before inviting anyone.');
    }
    return;
  }
  const want = { type: 'standard', ...GMAIL_SMTP, username: user, sender_email: user, sender_name: SENDER_NAME };
  if (FORCE_SMTP || Object.entries(want).some(([k, v]) => current[k] !== v)) {
    api('PATCH', `${base}/auth/email_provider`, { body: { ...want, password } });
    did(on(`SMTP ${GMAIL_SMTP.host} as "${SENDER_NAME}" <${user}>`));
  } else same(on(`SMTP ${GMAIL_SMTP.host} as "${SENDER_NAME}" <${user}> (--smtp re-sends the app password)`));
}

const prod = await setUpBranch(main, { production: true });
const devUrls = await setUpBranch(dev, { production: false });
save({
  NEON_DB_URL: prod.pooled,
  NEON_DB_URL_DIRECT: prod.direct,
  NEON_AUTH_URL: prod.authUrl,
  NEON_AUTH_JWKS_URL: prod.jwksUrl,
  NEON_DATA_API_URL: prod.dataApiUrl,
});

// The usage guard's key (#70): project-scoped, so the Worker can read this project's usage and nothing else.
{
  let key = cur.NEON_GUARD_API_KEY;
  if (key) {
    const r = await getJson(`https://console.neon.tech/api/v2/projects/${pid}`, { authorization: `Bearer ${key}`, accept: 'application/json' });
    if (r.ok) same('project-scoped API key for the usage guard');
    else {
      warn(`NEON_GUARD_API_KEY was refused (${r.status}); making a new one.`);
      key = null;
    }
  }
  if (!key) {
    const made = json(run('neon', ['api-keys', 'create', '--name', `${names.worker}-usage-guard`, '--project-id', pid, '-o', 'json']).stdout);
    if (!made.key) throw new Error(`neon api-keys create gave no key: ${Object.keys(made).join(', ')}`);
    did(`project-scoped API key ${names.worker}-usage-guard`);
    updateEnv(ENV_FILE, { NEON_GUARD_API_KEY: made.key });
    cur.NEON_GUARD_API_KEY = made.key;
  }
}

// ---- the Worker ----

section('Worker');
const kvList = () => json(wrangler(['kv', 'namespace', 'list']).stdout).find((n) => n.title === names.kv);
let kv = kvList();
if (!kv) {
  wrangler(['kv', 'namespace', 'create', names.kv]);
  kv = kvList();
  if (!kv) fail(`created KV namespace ${names.kv}, but it isn't listed`);
  did(`KV namespace ${names.kv} (${kv.id})`);
} else same(`KV namespace ${names.kv} (${kv.id})`);

const baseConfig = parseJsonc(readFileSync(join(WORKER_DIR, 'wrangler.jsonc'), 'utf8'));
const config = {
  ...baseConfig,
  name: names.worker,
  kv_namespaces: baseConfig.kv_namespaces.map((n) => (n.binding === 'WORLDS' ? { ...n, id: kv.id } : n)),
  vars: {
    ...baseConfig.vars,
    NEON_AUTH_JWKS_URL: prod.jwksUrl,
    NEON_AUTH_ISSUER: prod.issuer,
    VAPID_PUBLIC_KEY: cur.VAPID_PUBLIC_KEY,
    VAPID_SUBJECT: cur.VAPID_SUBJECT,
    NEON_PROJECT_ID: pid,
  },
};
const secrets = Object.fromEntries(
  Object.entries({
    NEON_DB_URL: prod.pooled,
    GROQ_API_KEY: cur.GROQ_API_KEY,
    VAPID_PRIVATE_KEY: cur.VAPID_PRIVATE_KEY,
    NEON_API_KEY: cur.NEON_GUARD_API_KEY,
  }).filter(([, v]) => v),
);
// Next to wrangler.jsonc so `main` resolves the same; git-ignored.
const CONFIG = join(WORKER_DIR, 'wrangler.provision.json');
writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`);
const bundle = join(TMP, 'worker-bundle');
wrangler(['deploy', '--config', CONFIG, '--dry-run', '--outdir', bundle], { cwd: WORKER_DIR, timeout: 300_000 });
// The tag names what's deployed: the bundle, the config (vars, bindings) and the secrets, hashed together.
// Not the dry run's README (a timestamp) or source map (its sourceRoot is the temp dir); maps aren't uploaded.
const workerBuild = hashDir(bundle, (name) => name === 'README.md' || name.endsWith('.map'));
const tag = `p${sha256(workerBuild, JSON.stringify(config), JSON.stringify(secrets)).slice(0, 20)}`;

function deployedTag() {
  const status = wrangler(['deployments', 'status', '--name', names.worker, '--json'], { check: false });
  if (status.status !== 0) return null;
  const versionId = json(status.stdout).versions?.find((v) => v.percentage === 100)?.version_id ?? json(status.stdout).versions?.[0]?.version_id;
  if (!versionId) return null;
  const view = wrangler(['versions', 'view', versionId, '--name', names.worker, '--json'], { check: false });
  return view.status === 0 ? (json(view.stdout).annotations?.['workers/tag'] ?? null) : null;
}
if (deployedTag() === tag) same(`Worker ${names.worker} is up to date (${tag})`);
else {
  const secretsFile = join(TMP, `secrets-${randomUUID()}.json`);
  writeFileSync(secretsFile, JSON.stringify(secrets), { mode: 0o600 });
  try {
    wrangler(['deploy', '--config', CONFIG, '--tag', tag, '--message', `provision ${tag}`, '--secrets-file', secretsFile], { cwd: WORKER_DIR, timeout: 600_000 });
  } finally {
    rmSync(secretsFile, { force: true });
  }
  did(`Worker ${names.worker} deployed (${tag}), secrets ${Object.keys(secrets).join(', ')}`);
}
rmSync(CONFIG, { force: true });

const { token: cfToken } = json(wrangler(['auth', 'token', '--json']).stdout);
const sub = await getJson(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/subdomain`, { authorization: `Bearer ${cfToken}` });
if (!sub.ok || !sub.body.result?.subdomain) fail(`couldn't read the account's workers.dev subdomain: ${sub.status} ${JSON.stringify(sub.body).slice(0, 300)}`);
const WORKER_URL = `https://${names.worker}.${sub.body.result.subdomain}.workers.dev`;
save({ WORKER_URL });

// ---- Pages ----

section('Pages');
run('npm', ['run', 'build:web'], {
  cwd: ROOT,
  timeout: 600_000,
  env: {
    ...process.env,
    VITE_NEON_AUTH_URL: prod.authUrl,
    VITE_DATA_API_URL: prod.dataApiUrl,
    VITE_WORKER_URL: WORKER_URL,
    VITE_VAPID_PUBLIC_KEY: cur.VAPID_PUBLIC_KEY,
  },
});
const build = hashDir(WEB_DIST).slice(0, 40);
const deployments = json(wrangler(['pages', 'deployment', 'list', '--project-name', names.pages, '--environment', 'production', '--json']).stdout);
const live = deployments.find((d) => d.Branch === 'main');
// Pages lists the deployment's commit hash cut to 7 characters.
if (live && live.Source === build.slice(0, 7)) same(`Pages ${names.pages} is up to date (build ${build.slice(0, 12)}), ${PAGES_URL}`);
else {
  wrangler(
    ['pages', 'deploy', WEB_DIST, '--project-name', names.pages, '--branch', 'main', '--commit-hash', build, '--commit-message', `provision build ${build.slice(0, 12)}`, '--commit-dirty=true'],
    { timeout: 600_000 },
  );
  did(`Pages ${names.pages} deployed (build ${build.slice(0, 12)}), ${PAGES_URL}`);
}
save({ PAGES_PROJECT: names.pages, PAGES_URL });

// ---- local dev: the dev branch ----

section('Local dev (the dev branch)');
const devEnv = updateEnv(
  DEV_ENV,
  {
    DATABASE_URL: devUrls.pooled,
    DATABASE_URL_UNPOOLED: devUrls.direct,
    NEON_BRANCH: 'dev',
    NEON_AUTH_BASE_URL: devUrls.authUrl,
    NEON_AUTH_JWKS_URL: devUrls.jwksUrl,
    NEON_DATA_API_URL: devUrls.dataApiUrl,
    VAPID_PUBLIC_KEY: cur.VAPID_PUBLIC_KEY,
  },
  { quote: false },
);
const devVars = updateEnv(
  DEV_VARS,
  {
    NEON_DB_URL: devUrls.pooled,
    NEON_AUTH_JWKS_URL: devUrls.jwksUrl,
    NEON_AUTH_ISSUER: devUrls.issuer,
    GROQ_API_KEY: cur.GROQ_API_KEY || null,
    VAPID_PUBLIC_KEY: cur.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: cur.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: cur.VAPID_SUBJECT,
    NEON_API_KEY: cur.NEON_GUARD_API_KEY,
    NEON_PROJECT_ID: pid,
  },
  { quote: false },
);
for (const [file, keys] of [
  [DEV_ENV, devEnv],
  [DEV_VARS, devVars],
]) {
  if (keys.length) did(`${relative(ROOT, file) || file}: ${keys.join(', ')}`);
  else same(`${relative(ROOT, file) || file}`);
}

console.log(`\n${changes ? `✓ ${changes} change(s)` : '✓ no changes'}. Worker ${WORKER_URL} · site ${PAGES_URL}`);
