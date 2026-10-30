-- #32 Death, Return and the roster (data-model.md §1.2): Humiliations, with ended rows kept as history.
-- Deaths, Returns and grace live on the existing captains columns (died_at, returns_at, death_fact,
-- death_cause_tag, grace_until, alias_idx); Fears a Humiliation adds go in captain_fears (added = true).

create type humiliation_cat as enum ('bandage', 'lost_bit', 'disguise', 'epithet', 'fear');

create table humiliations (
  world_id uuid not null references worlds (id),
  no bigint not null, -- from the sim's per-world counter
  captain_id text not null,
  cat humiliation_cat not null,
  kind text not null, -- bank key (banks.humiliations): sets the overlay, its slot, pinning and muffling
  gained_fact bigint not null, -- the `humiliation` Fact (its Cause)
  gained_at timestamptz not null,
  expires_at timestamptz, -- bandages, about 2 days on
  ended_at timestamptz,
  ended_fact bigint, -- the `humiliation_ended` Fact: healed, Unmasked, replaced, or he died
  primary key (world_id, no),
  foreign key (world_id, captain_id) references captains (world_id, id),
  foreign key (world_id, gained_fact) references facts (world_id, no),
  foreign key (world_id, ended_fact) references facts (world_id, no),
  check ((ended_at is null) = (ended_fact is null))
);
create index humiliations_current_idx on humiliations (world_id, captain_id) where ended_at is null;

alter table humiliations enable row level security;
revoke all on humiliations from anon, authenticated;
grant select on humiliations to authenticated;
create policy humiliations_member_read on humiliations for select to authenticated using (is_world_member(world_id));
