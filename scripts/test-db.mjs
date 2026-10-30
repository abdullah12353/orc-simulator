// `npm run test:db`: hold the shared-DB lock, reset the local DB to THIS worktree's migrations,
// then run the Seam B suite. Extra args are passed to node --test (e.g. a single file:
// `npm run test:db -- packages/server/test/tick.test.ts`).
//
// Set ORC_SKIP_RESET=1 to skip the reset (only if you know the DB already has your migrations).
import { run, withDbLock } from './db-lock.mjs';

const extra = process.argv.slice(2);
const testArgs = [
  '--experimental-strip-types',
  '--disable-warning=ExperimentalWarning',
  '--test',
  '--test-concurrency=1',
  ...(extra.length > 0 ? extra : ['packages/server/test/**/*.test.ts']),
];

const code = await withDbLock(`test:db ${process.cwd()}`, async () => {
  if ((await run('npx', ['supabase', 'status', '-o', 'env'], { stdio: 'ignore' })) !== 0) {
    console.error('[test:db] local Supabase is not running; starting it');
    const started = await run('npx', ['supabase', 'start']);
    if (started !== 0) return started;
  }
  if (!process.env.ORC_SKIP_RESET) {
    const reset = await run('npx', ['supabase', 'db', 'reset', '--local', '--no-seed']);
    if (reset !== 0) return reset;
  }
  return run(process.execPath, testArgs, { shell: false });
});
process.exit(code);
