// Operator tool (#39, D59): register a prerecorded clip of an accuser saying a Player's mangled name, so
// that accuser can name him in Accusations. Upload the clip to storage first; this records its key.
//   npm run names:register -- --player <player uuid> --accuser <accuser slug> --key <storage key> --says "<mangled name>"
// Connects to ORC_DB_URL (default: the local stack). In production, use the service (postgres) DB URL.
import { parseArgs } from 'node:util';
import { content } from '@orc/content';
import { connect, NameRenderError, registerNameRender } from '@orc/server';

const { values } = parseArgs({
  options: {
    player: { type: 'string' },
    accuser: { type: 'string' },
    key: { type: 'string' },
    says: { type: 'string' },
  },
});
const accusers = content.cast.filter((c) => c.accuser).map((c) => c.id);
if (!values.player || !values.accuser || !values.key || !values.says) {
  console.error('usage: npm run names:register -- --player <uuid> --accuser <slug> --key <storage key> --says "<mangled name>"');
  console.error(`accusers: ${accusers.join(', ')}`);
  process.exit(2);
}

const sql = connect(process.env.ORC_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55422/postgres');
try {
  await registerNameRender(
    // The operator's script is the one place the real clock is the right clock.
    { sql, now: () => new Date() },
    { playerId: values.player, accuserId: values.accuser, clipKey: values.key, says: values.says },
  );
  console.log(`registered: ${values.accuser} says "${values.says}" for player ${values.player} (${values.key})`);
} catch (e) {
  if (!(e instanceof NameRenderError)) throw e;
  console.error(`refused: ${e.message}${e.message === 'not_an_accuser' ? ` (accusers: ${accusers.join(', ')})` : ''}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
