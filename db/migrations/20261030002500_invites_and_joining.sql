-- #25 Invites and joining (data-model.md §1.1): invites, player_private, and the RPCs to create and
-- revoke an invite and to join a world through one. Every Player is equal: any Player may invite or
-- revoke, and the creator gets nothing the others don't (D56).

-- ---------------------------------------------------------------- player_private

-- Owner-only half of a Player (decision 7). `players` stays public to world members.
create table player_private (
  player_id uuid primary key references players (id),
  gold int not null check (gold between 0 and 30),
  meddles_available smallint not null check (meddles_available between 0 and 6),
  last_seen_at timestamptz not null,
  first_open_at timestamptz,
  first_meddle_done boolean not null default false,
  hints_seen text[] not null default '{}',
  last_edition_no int not null default 0,
  pushes_today smallint not null default 0,
  push_day date
);

-- Every Player gets a private row the moment they exist, with the same starting resources for the
-- creator and for anyone who joins later: 30 gold and 3 Meddles (#20, from #7 and #8).
create function players_init_private() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into player_private (player_id, gold, meddles_available, last_seen_at)
  values (new.id, 30, 3, new.joined_at);
  return new;
end;
$$;
create trigger players_init_private after insert on players
  for each row execute function players_init_private();

-- True if the signed-in user is this Player. For owner-only policies (player_private now; the
-- ledger, Stakes, editions and pushes later). Security definer so it doesn't go through players' RLS.
create function owns_player(p uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from players where id = p and user_id = auth.uid() and removed_at is null);
$$;
revoke all on function owns_player(uuid) from public, anon;
grant execute on function owns_player(uuid) to authenticated, service_role;

-- Blame lines name Players, so two live Players in one world can't share a display name.
create unique index players_display_name_uq on players (world_id, lower(btrim(display_name)))
  where removed_at is null;

-- ---------------------------------------------------------------- invites

create table invites (
  token text primary key check (token ~ '^[0-9a-f]{32}$'), -- 128 random bits, hex
  world_id uuid not null references worlds (id),
  created_by uuid not null references players (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at)
);
create index invites_world_idx on invites (world_id, created_at desc);

-- ---------------------------------------------------------------- RLS and grants

alter table player_private enable row level security;
alter table invites enable row level security;

revoke all on player_private, invites from anon, authenticated;
grant select on player_private, invites to authenticated;

create policy player_private_owner_read on player_private for select to authenticated
  using (owns_player(player_id));
create policy invites_members_read on invites for select to authenticated
  using (is_world_member(world_id));

-- ---------------------------------------------------------------- RPCs

-- The caller's live Player in a world, or null.
create function my_player(w uuid) returns uuid
language sql stable security definer set search_path = public
as $$
  select id from players where world_id = w and user_id = auth.uid() and removed_at is null;
$$;
revoke all on function my_player(uuid) from public, anon;
grant execute on function my_player(uuid) to authenticated, service_role;

-- A new invite link for a world the caller plays in, valid for 7 days and reusable until then.
create function create_invite(world_id uuid) returns invites
language plpgsql volatile security definer set search_path = public
as $$
declare
  me uuid := my_player(create_invite.world_id);
  inv invites;
begin
  if me is null then
    raise exception 'not_a_player' using errcode = 'P0001', detail = 'Only a Player in this world can invite.';
  end if;
  insert into invites (token, world_id, created_by, created_at, expires_at)
  values (encode(extensions.gen_random_bytes(16), 'hex'), create_invite.world_id, me, now(), now() + interval '7 days')
  returning * into inv;
  return inv;
end;
$$;

-- Kills an invite for good. Any Player in its world may revoke it. Revoking twice is a no-op.
create function revoke_invite(token text) returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  w uuid;
begin
  select i.world_id into w from invites i where i.token = revoke_invite.token;
  if w is null or my_player(w) is null then
    raise exception 'invite_not_found' using errcode = 'P0001', detail = 'That invite link does not exist.';
  end if;
  update invites i set revoked_at = now() where i.token = revoke_invite.token and i.revoked_at is null;
end;
$$;

-- What an invite would do for the caller, without joining: for the accept screen.
-- status: ok | not_found | revoked | expired | member | full
create function invite_info(token text)
returns table (status text, world_id uuid, world_name text, player_count int, expires_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
declare
  inv invites;
  n int;
begin
  select * into inv from invites i where i.token = invite_info.token;
  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::int, null::timestamptz;
    return;
  end if;
  select count(*)::int into n from players p where p.world_id = inv.world_id and p.removed_at is null;
  return query
  select case
           when inv.revoked_at is not null then 'revoked'
           when inv.expires_at <= now() then 'expired'
           when exists (select 1 from players p where p.world_id = inv.world_id and p.user_id = auth.uid()) then 'member'
           when n >= 8 then 'full'
           else 'ok'
         end,
         inv.world_id, w.name, n, inv.expires_at
  from worlds w where w.id = inv.world_id;
end;
$$;

-- Joins the caller to the invite's world as a new Player named `display_name` (shown in Blame lines).
-- Fails with a clear reason: invite_not_found, invite_revoked, invite_expired, already_joined,
-- world_full, bad_display_name or display_name_taken. At most 8 Players per world.
create function join_world(token text, display_name text) returns uuid
language plpgsql volatile security definer set search_path = public
as $$
declare
  inv invites;
  uid uuid := auth.uid();
  nm text := btrim(coalesce(join_world.display_name, ''));
  n int;
  pid uuid;
begin
  if uid is null then
    raise exception 'not_signed_in' using errcode = 'P0001', detail = 'Sign in before joining.';
  end if;
  select * into inv from invites i where i.token = join_world.token;
  if not found then
    raise exception 'invite_not_found' using errcode = 'P0001', detail = 'That invite link does not exist.';
  end if;
  if inv.revoked_at is not null then
    raise exception 'invite_revoked' using errcode = 'P0001', detail = 'That invite link has been revoked.';
  end if;
  if inv.expires_at <= now() then
    raise exception 'invite_expired' using errcode = 'P0001', detail = 'That invite link has expired.';
  end if;

  -- Serialise joins per world so two friends can't both take the 8th seat. An advisory lock rather
  -- than the world row, which belongs to the tick (FOR UPDATE NOWAIT).
  perform pg_advisory_xact_lock(hashtextextended('join:' || inv.world_id::text, 0));

  if exists (select 1 from players p where p.world_id = inv.world_id and p.user_id = uid) then
    raise exception 'already_joined' using errcode = 'P0001', detail = 'You are already a Player in this world.';
  end if;
  select count(*)::int into n from players p where p.world_id = inv.world_id and p.removed_at is null;
  if n >= 8 then
    raise exception 'world_full' using errcode = 'P0001', detail = 'This world already has 8 Players.';
  end if;
  if length(nm) not between 1 and 40 then
    raise exception 'bad_display_name' using errcode = 'P0001', detail = 'Your display name needs 1–40 characters.';
  end if;
  if exists (select 1 from players p
             where p.world_id = inv.world_id and p.removed_at is null and lower(btrim(p.display_name)) = lower(nm)) then
    raise exception 'display_name_taken' using errcode = 'P0001', detail = 'Another Player already goes by that name.';
  end if;

  insert into players (world_id, user_id, display_name, joined_at)
  values (inv.world_id, uid, nm, now())
  returning id into pid;
  return pid;
end;
$$;

revoke all on function create_invite(uuid), revoke_invite(text), invite_info(text), join_world(text, text)
  from public, anon;
grant execute on function create_invite(uuid), revoke_invite(text), invite_info(text), join_world(text, text)
  to authenticated;
