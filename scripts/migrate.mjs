// Applies db/migrations/*.sql in name order, each file in its own transaction, and records each in
// `schema_migrations` so a second run skips it (#60 item 2). Tests, local dev and deploy all use it; on
// Neon, deploy then runs `neon data-api refresh-schema` (#53).
//
//   ORC_DB_URL=<url> node scripts/migrate.mjs      (or DATABASE_URL)
//   import { migrate } from './migrate.mjs'
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postgres from 'postgres';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../db/migrations/', import.meta.url));

/** Applies every migration not yet recorded. Returns the names it applied. */
export async function migrate(url, { dir = MIGRATIONS_DIR, log = (line) => console.error(line) } = {}) {
  // One connection, so the session lock below covers every statement.
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    // Two runs against one database take turns; the second finds the files recorded.
    await sql`select pg_advisory_lock(hashtextextended('orc:migrate', 0))`;
    await sql`
      create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )`;
    const done = new Set((await sql`select name from schema_migrations`).map((r) => r.name));
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const applied = [];
    for (const name of files) {
      if (done.has(name)) continue;
      const body = readFileSync(join(dir, name), 'utf8');
      await sql
        .begin(async (tx) => {
          await tx.unsafe(body);
          await tx`insert into schema_migrations (name) values (${name})`;
        })
        .catch((e) => {
          throw new Error(`${name}: ${e instanceof Error ? e.message : e}`, { cause: e });
        });
      log(`[migrate] applied ${name}`);
      applied.push(name);
    }
    log(`[migrate] ${applied.length} applied, ${files.length - applied.length} already there`);
    return applied;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const url = process.env.ORC_DB_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('usage: ORC_DB_URL=<postgres url> node scripts/migrate.mjs');
    process.exit(2);
  }
  try {
    await migrate(url);
  } catch (e) {
    console.error(`[migrate] failed: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
