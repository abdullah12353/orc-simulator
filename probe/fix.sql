-- Fix candidate for policies: the helper gets an ignored default parameter that calls auth.uid() as the caller,
-- which initialises pg_session_jwt on a fresh connection before the definer body runs.
create or replace function my_player_init(w uuid, _init uuid default auth.uid()) returns uuid language sql stable security definer set search_path = public as $$
  select id from players where world_id = w and user_id = auth.uid() and removed_at is null
$$;
revoke all on function my_player_init(uuid, uuid) from public;
grant execute on function my_player_init(uuid, uuid) to authenticated;
drop policy if exists worlds_member on worlds;
create policy worlds_member on worlds for select to authenticated using (my_player_init(id) is not null);
-- Second candidate on players: an inline auth.uid() guard ahead of the definer helper.
drop policy if exists players_member on players;
create policy players_member on players for select to authenticated using (auth.uid() is not null and my_player(world_id) is not null);
