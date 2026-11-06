// `npm run test:db`: Seam B on plain Postgres 18.6 (#61). In the shared local container (db/compose.yaml,
// started if it isn't running), it drops and recreates THIS worktree's own database, orc_test_<hash of
// the worktree path>, applies db/local-shim.sql and the migrations, then runs the suite against it.
// No two worktrees share a database, so they can run at the same time.
//
//   npm run test:db -- packages/server/test/tick.test.ts   extra args go to node --test (e.g. one file)
//   ORC_SKIP_RESET=1    keep the database as it is: no drop, no shim, no migrations
//   ORC_DB_URL=<url>    run against that database instead (e.g. a Neon branch). It is migrated, never
//                       dropped, and gets no shim: Neon has the real auth objects.
//   ORC_PG_URL=<url>    the server to make the worktree's database in (default: the container)
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { migrate } from './migrate.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const COMPOSE = fileURLToPath(new URL('../db/compose.yaml', import.meta.url));
const SHIM = fileURLToPath(new URL('../db/local-shim.sql', import.meta.url));
const SERVER_URL = process.env.ORC_PG_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55432/postgres';

const extra = process.argv.slice(2);
const testArgs = [
  '--experimental-strip-types',
  '--disable-warning=ExperimentalWarning',
  '--test',
  '--test-concurrency=1',
  ...(extra.length > 0 ? extra : ['packages/server/test/**/*.test.ts']),
];

/** This worktree's database: the same name on every run from the same folder. */
function worktreeDatabase(root = ROOT) {
  const path = process.platform === 'win32' ? root.toLowerCase() : root;
  return `orc_test_${createHash('sha256').update(path.replace(/[\\/]+$/, '')).digest('hex').slice(0, 12)}`;
}

/** Runs a command, inheriting stdio. Resolves with its exit code. */
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reachable(url) {
  const sql = postgres(url, { max: 1, connect_timeout: 3, onnotice: () => {} });
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

/** Starts the shared container unless the server already answers. */
async function ensureServer() {
  if (await reachable(SERVER_URL)) return;
  if (process.env.ORC_PG_URL) throw new Error(`[test:db] can't reach ORC_PG_URL`);
  console.error('[test:db] local Postgres is not running; starting it (docker compose -f db/compose.yaml up)');
  // Another worktree may be starting it at the same moment, in which case this can fail; either way,
  // wait until the server answers.
  await run('docker', ['compose', '-f', COMPOSE, 'up', '-d', '--wait']).catch((e) => {
    console.error(`[test:db] docker: ${e.message}`);
  });
  for (let i = 0; i < 60; i++) {
    if (await reachable(SERVER_URL)) return;
    await sleep(1000);
  }
  throw new Error('[test:db] local Postgres did not come up (is Docker running?)');
}

/** A database on the local server. */
function databaseUrl(name) {
  const url = new URL(SERVER_URL);
  url.pathname = `/${name}`;
  return url.href;
}

/** Drops and recreates this worktree's database, then applies the shim. */
async function resetLocal(name) {
  const admin = postgres(SERVER_URL, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists ${name} with (force)`);
    await admin.unsafe(`create database ${name}`);
  } finally {
    await admin.end({ timeout: 5 });
  }
  const db = postgres(databaseUrl(name), { max: 1, onnotice: () => {} });
  try {
    await db.unsafe(readFileSync(SHIM, 'utf8'));
  } finally {
    await db.end({ timeout: 5 });
  }
}

async function main() {
  let url = process.env.ORC_DB_URL;
  if (url) {
    console.error('[test:db] using ORC_DB_URL (migrated, not reset)');
    if (!process.env.ORC_SKIP_RESET) await migrate(url);
  } else {
    await ensureServer();
    const name = worktreeDatabase();
    url = databaseUrl(name);
    if (process.env.ORC_SKIP_RESET) {
      console.error(`[test:db] ${name}: ORC_SKIP_RESET, using it as it is`);
    } else {
      console.error(`[test:db] ${name}: recreating it for ${ROOT}`);
      await resetLocal(name);
      await migrate(url);
    }
  }
  return run(process.execPath, testArgs, { cwd: ROOT, env: { ...process.env, ORC_DB_URL: url } });
}

try {
  process.exit(await main());
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
