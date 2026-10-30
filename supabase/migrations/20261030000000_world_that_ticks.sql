-- #24 Tracer bullet: a world that ticks. Tables from data-model.md §1: worlds, players (minimal; #25 adds
-- the rest of onboarding), captains, facts (append-only) and ticks.

create type roster as enum ('active', 'reserve', 'dead');
create type tier as enum ('generated', 'templated', 'silent');

-- ---------------------------------------------------------------- worlds & players

create table worlds (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 60),
  created_by uuid, -- FK players, added below (the two rows are created together)
  seed bigint not null,
  tick_seq bigint not null default 0,
  last_tick_at timestamptz not null,
  next_no bigint not null default 1,
  warlord_id text,
  day date not null,
  deaths_today smallint not null default 0,
  content_version text not null,
  created_at timestamptz not null default now()
);

create table players (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references worlds (id),
  user_id uuid not null references auth.users (id),
  display_name text not null check (length(btrim(display_name)) between 1 and 40),
  mangled_names text[] not null default '{}',
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  unique (world_id, user_id)
);
create index players_user_idx on players (user_id);

alter table worlds
  add constraint worlds_created_by_fkey foreign key (created_by) references players (id)
  deferrable initially deferred;

-- Membership check used by every world-scoped RLS policy. Security definer so policies on
-- `players` itself don't recurse.
create function is_world_member(w uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from players p
    where p.world_id = w and p.user_id = auth.uid() and p.removed_at is null
  );
$$;
revoke all on function is_world_member(uuid) from public, anon;
grant execute on function is_world_member(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- captains

create table captains (
  world_id uuid not null references worlds (id),
  id text not null, -- cast slug from the content bundle
  roster roster not null,
  power smallint not null check (power between 1 and 10),
  infamy int not null default 0,
  traits text[] not null check (cardinality(traits) = 2),
  epithet text,
  alias_idx smallint check (alias_idx in (0, 1)),
  died_at timestamptz,
  returns_at timestamptz,
  death_fact bigint,
  death_cause_tag text,
  grace_until timestamptz,
  legendary_fact bigint,
  primary key (world_id, id)
);

-- ---------------------------------------------------------------- the event log

create table ticks (
  world_id uuid not null references worlds (id),
  seq bigint not null,
  at timestamptz not null,
  seed bigint not null,
  watched boolean not null,
  content_version text not null,
  intent_ids uuid[] not null default '{}',
  fact_count smallint not null,
  cpu_ms int not null,
  state_hash text not null,
  primary key (world_id, seq)
);

create table facts (
  world_id uuid not null references worlds (id),
  no bigint not null,
  tick_seq bigint not null,
  at timestamptz not null,
  kind text not null,
  story_no bigint not null,
  template_id text,
  variant smallint check (variant between 0 and 2),
  line text not null,
  tier tier not null,
  "cast" text[] not null default '{}',
  comedy_weight smallint,
  payload jsonb not null,
  primary key (world_id, no)
);
create index facts_world_at_idx on facts (world_id, at desc);
create index facts_cast_idx on facts using gin ("cast");
create index facts_moments_idx on facts (world_id, at desc) where comedy_weight >= 20;
create index facts_template_idx on facts (world_id, template_id, at);

-- Facts are append-only for everyone. Grants keep API roles out; this trigger also stops the table
-- owner and the tick's own connection, which privileges alone can't.
create function facts_are_append_only() returns trigger
language plpgsql
as $$
begin
  raise exception 'facts are append-only: % is not allowed', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;
create trigger facts_no_update_delete before update or delete on facts
  for each row execute function facts_are_append_only();
create trigger facts_no_truncate before truncate on facts
  for each statement execute function facts_are_append_only();

-- ---------------------------------------------------------------- RLS and grants

alter table worlds enable row level security;
alter table players enable row level security;
alter table captains enable row level security;
alter table facts enable row level security;
alter table ticks enable row level security;

revoke all on worlds, players, captains, facts, ticks from anon, authenticated;
grant select on worlds, players, captains, facts to authenticated;
revoke update, delete, truncate on facts from service_role;

create policy worlds_members_read on worlds for select to authenticated using (is_world_member(id));
create policy players_members_read on players for select to authenticated using (is_world_member(world_id));
create policy captains_members_read on captains for select to authenticated using (is_world_member(world_id));
create policy facts_members_read on facts for select to authenticated using (is_world_member(world_id));
-- ticks: service only (no policy).
