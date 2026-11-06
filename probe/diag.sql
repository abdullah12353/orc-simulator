-- Item 5 follow-up: which role and claims does a request see when auth.uid() comes back null?
create or replace function whoami_full() returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare outer_role text := current_setting('role', true);
begin return jsonb_build_object('uid', auth.uid(), 'role_setting', outer_role, 'claims', current_setting('request.jwt.claims', true),
  'backend_pid', pg_backend_pid(), 'xact', txid_current()); end $$;
grant execute on function whoami_full() to authenticated;
