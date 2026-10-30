-- Review fixes on build/mvp (server area).

-- ---------------------------------------------------------------- the world seed is service-only

-- The sim is open source, so a member who could read `worlds.seed` could run every tick ahead and know
-- how a Clash goes before Backing it. The seed moves to its own table that only the service role reads,
-- like `ticks` (whose per-tick seeds were already hidden). Deviation from data-model §1 (`worlds.seed`),
-- in the split-table style of decision 7 rather than a column grant.
create table world_seeds (
  world_id uuid primary key references worlds (id),
  seed bigint not null -- a uint32 (`tickSeed(seed, tick_seq)` is each tick's seed)
);
insert into world_seeds (world_id, seed) select id, seed from worlds;
alter table worlds drop column seed;

alter table world_seeds enable row level security;
revoke all on world_seeds from anon, authenticated;
-- No policy: service only.

-- ---------------------------------------------------------------- the Hall timeline, each story once

-- A Legendary deed heavy enough to be an infamous moment came twice on the timeline (once per shelf).
-- It now comes once, as the legend; the moment shelf itself (hall_moments) still lists it. All three
-- branches (legend, moment, clipping) and the column list are kept.
create or replace view hall_timeline with (security_invoker = true) as
  select t.* from (
    select world_id, 'legend'::text as shelf, fact_no, captain_id, at, kind, caption, comedy_weight,
           null::uuid as clipping_id
    from hall_legends
    union all
    select m.world_id, 'moment', m.fact_no, null, m.at, m.kind, m.caption, m.comedy_weight, null
    from hall_moments m
    where not exists (select 1 from captains c where c.world_id = m.world_id and c.legendary_fact = m.fact_no)
    union all
    select world_id, 'clipping', story_no, null, created_at, snapshot->>'kind', snapshot->>'headline', null, id
    from clippings
  ) t
  order by t.at desc, t.fact_no desc, t.shelf;
