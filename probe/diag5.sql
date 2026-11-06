-- Workaround: an ignored parameter whose default calls auth.uid() in the caller's context first.
-- The body never trusts _init; it calls auth.uid() itself.
create or replace function whoami_init(_init uuid default auth.uid()) returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin return jsonb_build_object('uid', auth.uid(), 'init', _init, 'backend_pid', pg_backend_pid()); end $$;
grant execute on function whoami_init(uuid) to authenticated;
