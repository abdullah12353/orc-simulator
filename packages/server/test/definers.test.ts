// #53, #57: every security definer function in `public` takes `_init uuid default auth.uid()`. On Neon,
// auth.uid() inside a definer function is null on a connection's first request unless the caller read the
// JWT first, and that default makes the caller read it. The local shim can't reproduce the null, so this
// is checked on the catalogue instead. Trigger functions take no arguments, so they're exempt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Sql } from '@orc/server';
import { db } from './support.ts';

const INIT = /(^|, )_init uuid DEFAULT auth\.uid\(\)$/;

async function definers(sql: Sql) {
  return sql<{ fn: string; args: string }[]>`
    select p.oid::regprocedure::text as fn, pg_get_function_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
    order by 1`;
}
const lackingInit = async (sql: Sql) => (await definers(sql)).filter((d) => !INIT.test(d.args)).map((d) => d.fn);

test('every security definer function in public ends with `_init uuid default auth.uid()`', async () => {
  const all = await definers(db());
  assert.ok(all.length >= 15, `found ${all.length} definer functions`);
  assert.deepEqual(await lackingInit(db()), []);
});

test('the check catches a definer function without `_init`', async () => {
  let caught: string[] = [];
  await db()
    .begin(async (tx) => {
      await tx`create function public.leaky(w uuid) returns uuid language sql security definer as $$ select w $$`;
      caught = await lackingInit(tx as unknown as Sql);
      throw new Undo();
    })
    .catch((e: unknown) => {
      if (!(e instanceof Undo)) throw e;
    });
  assert.deepEqual(caught, ['leaky(uuid)']);
});
class Undo extends Error {}
