-- #34 Infamy, the Warlord and Legendary (data-model.md §1.1, §4.4; D42, D43, D45). Every Infamy gain is
-- recorded per Fact, so the 7-day window (succession and benching) and Backing payouts (#36) can be summed
-- over time. Lifetime Infamy, Power and the Legendary deed live on `captains` (already there).

create table infamy_gains (
  world_id uuid not null,
  fact_no bigint not null,
  captain_id text not null,
  amount smallint not null check (amount > 0),
  primary key (world_id, fact_no, captain_id),
  -- Not to captains: create_world writes day zero's Facts (and their gains) before the Captains.
  foreign key (world_id, fact_no) references facts (world_id, no)
);
create index infamy_gains_captain_idx on infamy_gains (world_id, captain_id, fact_no);

-- Append-only like the Facts they belong to.
create trigger infamy_gains_no_update_delete before update or delete on infamy_gains
  for each row execute function facts_are_append_only();
create trigger infamy_gains_no_truncate before truncate on infamy_gains
  for each statement execute function facts_are_append_only();

alter table infamy_gains enable row level security;
revoke all on infamy_gains from anon, authenticated;
grant select on infamy_gains to authenticated;
revoke update, delete, truncate on infamy_gains from service_role;
-- World-readable, like the Facts that carry the same numbers.
create policy infamy_gains_members_read on infamy_gains for select to authenticated using (is_world_member(world_id));

-- The 7-day window per Captain (§4.4), for the Captain card. Security invoker: members only, under RLS.
create view infamy_7d with (security_invoker = true) as
  select g.world_id, g.captain_id, sum(g.amount)::int as infamy
  from infamy_gains g join facts f on f.world_id = g.world_id and f.no = g.fact_no
  where f.at > now() - interval '7 days'
  group by g.world_id, g.captain_id;
revoke all on infamy_7d from anon, authenticated;
grant select on infamy_7d to authenticated;

-- The Herald and the Hall of Shame look up Legendary deeds by story (§4.1, §4.3).
create index facts_legendary_idx on facts (world_id, story_no) where kind = 'legendary';
