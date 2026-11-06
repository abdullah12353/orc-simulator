-- Is the first-request null specific to security definer? Same probe as whoami_full, but as invoker.
grant usage on schema auth to authenticated;
create or replace function whoami_inv() returns jsonb language plpgsql volatile security invoker set search_path = public as $$
begin return jsonb_build_object('uid', auth.uid(), 'role_setting', current_setting('role', true), 'claims', current_setting('request.jwt.claims', true),
  'backend_pid', pg_backend_pid()); end $$;
grant execute on function whoami_inv() to authenticated;
