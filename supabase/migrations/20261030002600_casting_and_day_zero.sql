-- #26 Casting and day zero: captain_fears, affinity (directed) and grudge_tags (data-model.md §1.2–1.3).
-- World-readable by members, written only by the sim's commit (create_world, the tick).

create table captain_fears (
  world_id uuid not null references worlds (id),
  captain_id text not null,
  fear text not null,
  added boolean not null, -- false = the starting Fear, never replaced
  since timestamptz not null,
  cause_fact bigint,
  primary key (world_id, captain_id, fear),
  foreign key (world_id, captain_id) references captains (world_id, id)
);

-- Directed: holder's feeling toward toward (data-model decision 11). Rows at 0 are deleted.
create table affinity (
  world_id uuid not null references worlds (id),
  holder_id text not null,
  toward_id text not null,
  value smallint not null check (value between -100 and 100 and value <> 0),
  updated_at timestamptz not null,
  primary key (world_id, holder_id, toward_id),
  check (holder_id <> toward_id),
  foreign key (world_id, holder_id) references captains (world_id, id),
  foreign key (world_id, toward_id) references captains (world_id, id)
);

-- Permanent. `no` comes from the sim's per-world counter (worlds.next_no).
create table grudge_tags (
  world_id uuid not null references worlds (id),
  no bigint not null,
  holder_id text not null,
  toward_id text not null,
  tag text not null,
  cause_fact bigint, -- null only for old history seeded at casting (it predates the log)
  created_at timestamptz not null,
  primary key (world_id, no),
  check (holder_id <> toward_id),
  foreign key (world_id, holder_id) references captains (world_id, id),
  foreign key (world_id, toward_id) references captains (world_id, id)
);
create index grudge_tags_pair_idx on grudge_tags (world_id, holder_id, toward_id, no desc);

alter table captain_fears enable row level security;
alter table affinity enable row level security;
alter table grudge_tags enable row level security;

revoke all on captain_fears, affinity, grudge_tags from anon, authenticated;
grant select on captain_fears, affinity, grudge_tags to authenticated;

create policy captain_fears_members_read on captain_fears for select to authenticated using (is_world_member(world_id));
create policy affinity_members_read on affinity for select to authenticated using (is_world_member(world_id));
create policy grudge_tags_members_read on grudge_tags for select to authenticated using (is_world_member(world_id));
