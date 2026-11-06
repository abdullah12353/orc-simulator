-- #29 Blame chains (data-model §1.5, decisions 8 and 9): the causal DAG's edges and the transitive
-- Blame set per Fact, both written by the tick alongside the Facts and, like them, append-only.

create table fact_causes (
  world_id uuid not null,
  fact_no bigint not null,
  cause_no bigint not null,
  primary key (world_id, fact_no, cause_no),
  foreign key (world_id, fact_no) references facts (world_id, no),
  foreign key (world_id, cause_no) references facts (world_id, no)
);

-- Materialised at write time (decision 9): "who is to blame" is one indexed lookup, never a recursion.
-- verb, landed_fact and landed_at copy the Meddle's landing (deviation from data-model §1.5, which
-- lists only meddle_id, player_id and hops), so the tick loads a Cause and the Herald orders a Blame
-- line without joining meddles and facts.
create table fact_blame (
  world_id uuid not null,
  fact_no bigint not null,
  meddle_id uuid not null references meddles (id),
  player_id uuid not null references players (id),
  verb meddle_verb not null,
  landed_fact bigint not null,
  landed_at timestamptz not null,
  hops smallint not null check (hops between 0 and 6),
  primary key (world_id, fact_no, meddle_id),
  foreign key (world_id, fact_no) references facts (world_id, no),
  foreign key (world_id, landed_fact) references facts (world_id, no)
);
create index fact_blame_player_idx on fact_blame (player_id, fact_no);

create trigger fact_causes_no_update_delete before update or delete on fact_causes
  for each row execute function facts_are_append_only();
create trigger fact_causes_no_truncate before truncate on fact_causes
  for each statement execute function facts_are_append_only();
create trigger fact_blame_no_update_delete before update or delete on fact_blame
  for each row execute function facts_are_append_only();
create trigger fact_blame_no_truncate before truncate on fact_blame
  for each statement execute function facts_are_append_only();

alter table fact_causes enable row level security;
alter table fact_blame enable row level security;

revoke all on fact_causes, fact_blame from anon, authenticated;
grant select on fact_causes, fact_blame to authenticated;
revoke update, delete, truncate on fact_causes, fact_blame from service_role;

-- World-readable, like Facts: Blame is announced (D18), and only landed Meddles ever appear here.
create policy fact_causes_members_read on fact_causes for select to authenticated using (is_world_member(world_id));
create policy fact_blame_members_read on fact_blame for select to authenticated using (is_world_member(world_id));
