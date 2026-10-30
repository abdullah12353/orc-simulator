-- #31 Live watching (data-model §3 steps 2 and 7, D39): Players mark themselves seen while the app is
-- open, which makes the tick treat their world as watched (it steps every minute instead of every 5).

-- ---------------------------------------------------------------- mark_seen

-- The caller's Player in this world was seen now. The PWA calls it on open and about once a minute
-- while it's visible. Fails with: not_a_player.
create function mark_seen(world_id uuid) returns void
language plpgsql volatile security definer set search_path = public
as $$
begin
  update player_private pp set last_seen_at = greatest(pp.last_seen_at, now())
  from players p
  where p.id = pp.player_id and p.world_id = mark_seen.world_id and p.user_id = auth.uid() and p.removed_at is null;
  if not found then
    raise exception 'not_a_player' using errcode = 'P0001', detail = 'Only a Player in this world can watch it.';
  end if;
end;
$$;
revoke all on function mark_seen(uuid) from public, anon;
grant execute on function mark_seen(uuid) to authenticated;

-- ---------------------------------------------------------------- the world's Realtime channel

-- After a productive watched tick, the tick broadcasts {tick_seq} on the private channel `world:<id>`
-- (realtime.send, inside its transaction), and clients refetch. Realtime authorises a private-channel
-- join by reading realtime.messages under RLS with `realtime.topic` set, so this policy is the
-- membership check. There's no insert policy: clients never send on the channel.
create function can_hear_world(topic text) returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when topic ~ '^world:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then is_world_member(substr(topic, 7)::uuid)
    else false
  end;
$$;
revoke all on function can_hear_world(text) from public, anon;
grant execute on function can_hear_world(text) to authenticated, service_role;

create policy world_members_hear_broadcasts on realtime.messages for select to authenticated
  using (extension = 'broadcast' and can_hear_world((select realtime.topic())));
