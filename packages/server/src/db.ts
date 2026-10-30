import postgres from 'postgres';

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

/**
 * One postgres.js pool. `prepare: false` because production goes through Supavisor in transaction
 * mode (data-model decision 3), which can't hold prepared statements across transactions.
 */
export function connect(url: string, opts: { max?: number } = {}): Sql {
  return postgres(url, {
    prepare: false,
    max: opts.max ?? 1,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
}

/**
 * A jsonb parameter. Don't pass `JSON.stringify(x)` with a `::jsonb` cast: postgres.js learns the
 * parameter type from the server and JSON-encodes it again, turning it into a string scalar.
 */
export function jsonb(sql: Sql | Tx, value: unknown) {
  return sql.json(value as postgres.JSONValue);
}

/** Postgres error code for `FOR UPDATE NOWAIT` hitting a held row lock. */
export const LOCK_NOT_AVAILABLE = '55P03';

export function isLockNotAvailable(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === LOCK_NOT_AVAILABLE;
}
