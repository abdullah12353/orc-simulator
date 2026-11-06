-- Throwaway probe schema for #57: cut-down shapes of invite_info, submit_intent, a security_invoker view,
-- and players.user_id -> neon_auth.user(id). Safe to re-run: drops and recreates.
drop table if exists intents, invites, players, worlds cascade;
drop view if exists roster;
drop function if exists my_player(uuid), invite_info(text), submit_intent(uuid, uuid, text, jsonb), whoami();

create table worlds (id uuid primary key default gen_random_uuid(), name text not null);
create table players (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references worlds(id) on delete cascade,
  user_id uuid not null references neon_auth."user"(id) on delete cascade,  -- item 4
  name text not null,
  removed_at timestamptz,
  unique (world_id, user_id)
);
create table invites (token text primary key, world_id uuid not null references worlds(id), expires_at timestamptz not null);
create table intents (
  id uuid primary key, world_id uuid not null references worlds(id), player_id uuid not null references players(id),
  kind text not null, payload jsonb not null default '{}', status text not null default 'queued', created_at timestamptz not null default now()
);

alter table worlds enable row level security;
alter table players enable row level security;
alter table invites enable row level security;
alter table intents enable row level security;

create function my_player(w uuid) returns uuid language sql stable security definer set search_path = public as $$
  select id from players where world_id = w and user_id = auth.uid() and removed_at is null
$$;

create policy worlds_member on worlds for select to authenticated using (my_player(id) is not null);
create policy players_member on players for select to authenticated using (my_player(world_id) is not null);
create policy intents_mine on intents for select to authenticated using (player_id = my_player(world_id));

-- Table-returning RPC, callable without a membership (the invite page), like invite_info.
create function invite_info(token text)
returns table (status text, world_id uuid, world_name text, player_count int, expires_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare inv invites; n int;
begin
  select * into inv from invites i where i.token = invite_info.token;
  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::int, null::timestamptz; return;
  end if;
  select count(*)::int into n from players p where p.world_id = inv.world_id and p.removed_at is null;
  return query select case when inv.expires_at < now() then 'expired' else 'open' end,
    inv.world_id, (select w.name from worlds w where w.id = inv.world_id), n, inv.expires_at;
end $$;

-- security definer RPC that relies on auth.uid() (item 5), like submit_intent.
create function submit_intent(id uuid, world_id uuid, kind text, payload jsonb)
returns table (intent_id uuid, meddles_left int)
language plpgsql volatile security definer set search_path = public as $$
declare me uuid := my_player(submit_intent.world_id); n int;
begin
  if me is null then
    raise exception 'not_a_player' using errcode = 'P0001', detail = 'Only a Player in this world can meddle.';
  end if;
  insert into intents (id, world_id, player_id, kind, payload)
  values (submit_intent.id, submit_intent.world_id, me, submit_intent.kind, coalesce(submit_intent.payload, '{}'))
  on conflict on constraint intents_pkey do nothing;
  select count(*)::int into n from intents i where i.player_id = me and i.status = 'queued';
  return query select submit_intent.id, greatest(0, 3 - n);
end $$;

-- What the server sees for the caller, inside a security definer function.
create function whoami() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('uid', auth.uid(), 'user_id', auth.user_id(), 'current_user', current_user,
    'session_user', session_user, 'claims_setting', current_setting('request.jwt.claims', true))
$$;

-- security_invoker view: RLS on players applies as the caller.
create view roster with (security_invoker = true) as
  select p.world_id, p.name, w.name as world_name from players p join worlds w on w.id = p.world_id where p.removed_at is null;

revoke all on function invite_info(text), submit_intent(uuid, uuid, text, jsonb), whoami(), my_player(uuid) from public;
grant execute on function invite_info(text) to anonymous, authenticated;
grant execute on function submit_intent(uuid, uuid, text, jsonb), whoami() to authenticated;
grant select on worlds, players, intents, roster to authenticated;

-- Fix: RLS policies call my_player as the caller, so authenticated needs execute (the real migrations grant it too).
grant execute on function my_player(uuid) to authenticated;

-- Item 5 diagnostics: auth.uid() as seen from different function kinds.
drop function if exists whoami_plpgsql(), whoami_invoker();
create function whoami_plpgsql() returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin return jsonb_build_object('uid', auth.uid(), 'jwt_sub', auth.jwt()->>'sub', 'current_user', current_user); end $$;
create function whoami_invoker() returns jsonb language sql stable security invoker as $$
  select jsonb_build_object('uid', auth.uid(), 'jwt_sub', auth.jwt()->>'sub', 'current_user', current_user) $$;
grant execute on function whoami_plpgsql(), whoami_invoker() to authenticated;
