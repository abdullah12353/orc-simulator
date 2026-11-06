-- Workaround candidates for the fresh-connection null inside security definer.
create or replace function whoami_twice() returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare first uuid := auth.uid(); second uuid;
begin second := auth.uid();
  return jsonb_build_object('uid', coalesce(second, first), 'first', first, 'second', second, 'jwt', auth.jwt(),
    'role_setting', current_setting('role', true), 'claims', current_setting('request.jwt.claims', true), 'backend_pid', pg_backend_pid()); end $$;
grant execute on function whoami_twice() to authenticated;
