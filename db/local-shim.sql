-- Local only (#60 item 4, #61 item 3): stand-ins for what Neon provides and the migrations assume.
-- `npm run test:db` applies this to a fresh database, then the migrations. Never applied to Neon.
--
-- It copies Neon's shape where the code can tell the difference:
--   - `authenticated` and `anonymous` are nologin roles, and only the owner has usage on the `auth`
--     schema, as on Neon (there `auth` belongs to cloud_admin). Code running as `authenticated` can
--     call auth.uid() through a stored reference (a parameter default, as `_init` does) but not by
--     name, which is #57's "security invoker functions can't call auth.uid()".
--   - auth.uid() and auth.jwt() read `request.jwt.claims`, the fallback pg_session_jwt uses when no
--     JWT session was initialised. The tests' `asUser` sets it, as the Data API would.
--   - neon_auth."user" has the NOT NULL columns of Neon Auth's real table (Better Auth's camelCase
--     names), so the tests' inserts work on a Neon branch too.
-- It can't reproduce Neon's null auth.uid() inside a definer function on a fresh connection, which is
-- why `_init` is checked structurally (definers.test.ts).

-- Roles are per server, not per database, so every worktree's database shares them. Two runs starting
-- at once may race to create them; the loser just finds them there.
do $$
begin
  create role authenticated nologin;
exception when duplicate_object or unique_violation then null;
end $$;
do $$
begin
  create role anonymous nologin;
exception when duplicate_object or unique_violation then null;
end $$;

create schema if not exists auth;
revoke all on schema auth from public;

create or replace function auth.jwt() returns jsonb
language sql stable
as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;

-- Reads the setting itself rather than calling auth.jwt(): a caller without usage on `auth` couldn't
-- resolve that name.
create or replace function auth.uid() returns uuid
language sql stable
as $$ select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;

create schema if not exists neon_auth;
revoke all on schema neon_auth from public;

create table if not exists neon_auth."user" (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  "emailVerified" boolean not null,
  image text,
  "createdAt" timestamptz not null default current_timestamp,
  "updatedAt" timestamptz not null default current_timestamp
);
