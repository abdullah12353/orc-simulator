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
