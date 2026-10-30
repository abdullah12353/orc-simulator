-- #30 Grudge Clashes and the Clash card (data-model.md §1.2, §1.5): Trophies (current holder only) and
-- each Clash's dialogue, written with its fallback script in the tick's own transaction. Reaction Fuses
-- use the existing fuses columns (kind 'reaction', template_id, cast, parent_fact).

-- A Trophy, as currently held (D15: a tag, not an inventory; the history is in the log).
create table trophies (
  world_id uuid not null references worlds (id),
  no bigint not null, -- from the sim's per-world counter
  kind text not null, -- bank key (banks.trophies)
  holder_id text not null,
  taken_from_id text not null,
  origin_fact bigint not null, -- the `trophy` Fact that put it in the holder's hands (its Cause)
  acquired_at timestamptz not null,
  primary key (world_id, no),
  foreign key (world_id, holder_id) references captains (world_id, id),
  foreign key (world_id, taken_from_id) references captains (world_id, id),
  foreign key (world_id, origin_fact) references facts (world_id, no)
);
create index trophies_holder_idx on trophies (world_id, holder_id);

-- What was said in a Clash: 3 lines, or 4 with a wrong saviour, the loser last. Written with the fallback
-- script at commit, upgraded once by the narration job (#37). Replays read this and never call a model.
create table clash_dialogue (
  world_id uuid not null,
  fact_no bigint not null,
  lines jsonb not null, -- [{speaker, text}], speaker = Captain slug
  source text not null check (source in ('generated', 'fallback')),
  fallback_key text not null, -- banks.clash.scripts key
  provider text,
  model text,
  updated_at timestamptz not null,
  primary key (world_id, fact_no),
  foreign key (world_id, fact_no) references facts (world_id, no),
  check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 3 and 4)
);

alter table trophies enable row level security;
alter table clash_dialogue enable row level security;

revoke all on trophies, clash_dialogue from anon, authenticated;
grant select on trophies, clash_dialogue to authenticated;

create policy trophies_member_read on trophies for select to authenticated using (is_world_member(world_id));
create policy clash_dialogue_member_read on clash_dialogue for select to authenticated using (is_world_member(world_id));
