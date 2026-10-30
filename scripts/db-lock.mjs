// A machine-wide lock around the one shared local Supabase database.
//
// Every worktree shares one stack but carries its own migrations, so anything that resets the DB or
// runs Seam B tests must hold this lock. It's an atomic mkdir; the holder refreshes a heartbeat file,
// and a lock whose heartbeat is older than STALE_MS (a crashed holder) is broken by the next waiter.
//
//   import { withDbLock } from './db-lock.mjs'
//   node scripts/db-lock.mjs -- <command...>      run one command while holding the lock
//   node scripts/db-lock.mjs --status             show who holds it
//
// Lock dir: $ORC_DB_LOCK_DIR, else ~/.t3/orc-build-notes/db.lock if that folder exists, else a temp dir.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const STALE_MS = Number(process.env.ORC_DB_LOCK_STALE_MS ?? 120_000);
const HEARTBEAT_MS = 10_000;
const POLL_MS = 2_000;
const WAIT_MAX_MS = Number(process.env.ORC_DB_LOCK_WAIT_MS ?? 45 * 60_000);

export function lockDir() {
  if (process.env.ORC_DB_LOCK_DIR) return process.env.ORC_DB_LOCK_DIR;
  const notes = join(homedir(), '.t3', 'orc-build-notes');
  return existsSync(notes) ? join(notes, 'db.lock') : join(tmpdir(), 'orc-simulator-db.lock');
}

const ownerFile = (dir) => join(dir, 'owner.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readOwner(dir) {
  try {
    const raw = readFileSync(ownerFile(dir), 'utf8');
    return { ...JSON.parse(raw), heartbeatAt: statSync(ownerFile(dir)).mtimeMs };
  } catch {
    // Owner file not written yet (or gone): fall back to the dir's own mtime.
    try {
      return { heartbeatAt: statSync(dir).mtimeMs };
    } catch {
      return null;
    }
  }
}

function describe(owner) {
  if (!owner) return 'nobody';
  const age = Math.round((Date.now() - owner.heartbeatAt) / 1000);
  return `${owner.label ?? '?'} (pid ${owner.pid ?? '?'}, cwd ${owner.cwd ?? '?'}, heartbeat ${age}s ago)`;
}

/** Acquires the lock, waiting for (or breaking a stale) holder. Returns a release function. */
export async function acquireDbLock(label = process.cwd()) {
  const dir = lockDir();
  const token = `${hostname()}:${process.pid}:${Date.now()}`;
  const started = Date.now();
  let lastNotice = 0;

  for (;;) {
    try {
      mkdirSync(dir);
      writeFileSync(
        ownerFile(dir),
        JSON.stringify({ token, label, pid: process.pid, cwd: process.cwd(), since: new Date().toISOString() }),
      );
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    const owner = readOwner(dir);
    if (owner && Date.now() - owner.heartbeatAt > STALE_MS) {
      console.error(`[db-lock] breaking stale lock held by ${describe(owner)}`);
      try {
        const graveyard = `${dir}.stale-${process.pid}-${Date.now()}`;
        renameSync(dir, graveyard);
        rmSync(graveyard, { recursive: true, force: true });
      } catch {
        // Someone else broke or released it first; just retry.
      }
      continue;
    }
    if (Date.now() - started > WAIT_MAX_MS) {
      throw new Error(`[db-lock] gave up after ${WAIT_MAX_MS / 60000} min; held by ${describe(owner)}`);
    }
    if (Date.now() - lastNotice > 30_000) {
      console.error(`[db-lock] waiting for the shared DB; held by ${describe(owner)}`);
      lastNotice = Date.now();
    }
    await sleep(POLL_MS);
  }

  const heartbeat = setInterval(() => {
    try {
      const now = new Date();
      utimesSync(ownerFile(dir), now, now);
    } catch {
      // Lock was broken under us; release() will notice.
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearInterval(heartbeat);
    try {
      const owner = JSON.parse(readFileSync(ownerFile(dir), 'utf8'));
      if (owner.token !== token) {
        console.error('[db-lock] lock was taken over by someone else; not removing it');
        return;
      }
    } catch {
      return; // already gone
    }
    rmSync(dir, { recursive: true, force: true });
  };
  process.once('exit', release);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(sig, () => {
      release();
      process.exit(130);
    });
  }
  console.error(`[db-lock] acquired ${dir}`);
  return release;
}

export async function withDbLock(label, fn) {
  const release = await acquireDbLock(label);
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Runs a command, inheriting stdio. Resolves with its exit code. */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--status') {
    const dir = lockDir();
    console.log(existsSync(dir) ? `held by ${describe(readOwner(dir))}` : `free (${dir})`);
  } else {
    const sep = argv.indexOf('--');
    const cmd = sep >= 0 ? argv.slice(sep + 1) : argv;
    if (cmd.length === 0) {
      console.error('usage: node scripts/db-lock.mjs [--status] | -- <command...>');
      process.exit(2);
    }
    const code = await withDbLock(cmd.join(' '), () => run(cmd[0], cmd.slice(1)));
    process.exit(code);
  }
}
