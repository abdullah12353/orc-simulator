-- #42 Pushes and install (data-model.md §1: push_subscriptions, push_jobs; D54): Web Push subscriptions
-- (owner-only) and the push outbox the tick's commit layer writes. The 3-a-day count lives in
-- player_private (pushes_today, push_day), which already exists.

-- One row per (Player, device). Deviation from data-model §1 (UQ endpoint): a user in two worlds has two
-- Players on the same device, so the endpoint is unique per Player, not globally.
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players (id),
  endpoint text not null check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique (player_id, endpoint)
);

-- `failed` (not in data-model §1): no device took it (every endpoint refused or gone), or it went stale
-- in the queue. `title`, `story_no`, `claimed_at`, `sent_at`, `detail` are not in data-model §1 either.
create type push_status as enum ('queued', 'sent', 'dropped_cap', 'dropped_quiet', 'failed');

create table push_jobs (
  id bigint generated always as identity primary key,
  world_id uuid not null references worlds (id),
  player_id uuid not null references players (id),
  fact_no bigint not null, -- the story head: tapping the push opens this story
  title text not null,
  text text not null,
  status push_status not null,
  created_at timestamptz not null,
  claimed_at timestamptz,
  sent_at timestamptz,
  detail text,
  foreign key (world_id, fact_no) references facts (world_id, no)
);
create index push_jobs_queued_idx on push_jobs (world_id, id) where status = 'queued';
create index push_jobs_player_idx on push_jobs (player_id, created_at);

alter table push_subscriptions enable row level security;
alter table push_jobs enable row level security;
revoke all on push_subscriptions, push_jobs from anon, authenticated;
grant select, delete on push_subscriptions to authenticated;
grant select on push_jobs to authenticated;
create policy push_subscriptions_owner_read on push_subscriptions for select to authenticated using (owns_player(player_id));
create policy push_subscriptions_owner_delete on push_subscriptions for delete to authenticated using (owns_player(player_id));
create policy push_jobs_owner_read on push_jobs for select to authenticated using (owns_player(player_id));

-- Opt in (or refresh the keys of) this device for the caller's Player in a world. Parameters are p_-prefixed
-- because `endpoint`/`auth` would clash with the table's columns in ON CONFLICT.
create function subscribe_push(p_world uuid, p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  me uuid := my_player(p_world);
begin
  if me is null then
    raise exception 'not_a_player' using errcode = 'P0001';
  end if;
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 2000
     or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = ''
     or length(p_p256dh) > 200 or length(p_auth) > 100 then
    raise exception 'bad_subscription' using errcode = 'P0001';
  end if;
  insert into push_subscriptions (player_id, endpoint, p256dh, auth)
  values (me, p_endpoint, p_p256dh, p_auth)
  on conflict (player_id, endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;
revoke all on function subscribe_push(uuid, text, text, text) from public, anon;
grant execute on function subscribe_push(uuid, text, text, text) to authenticated;

-- Opt this device out for the caller's Player in a world.
create function unsubscribe_push(p_world uuid, p_endpoint text) returns void
language sql volatile security definer set search_path = public
as $$
  delete from push_subscriptions where player_id = my_player(p_world) and endpoint = p_endpoint;
$$;
revoke all on function unsubscribe_push(uuid, text) from public, anon;
grant execute on function unsubscribe_push(uuid, text) to authenticated;
