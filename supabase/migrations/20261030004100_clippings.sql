-- #41 Clippings (D54, data-model §1, §4.3): any Herald story cut into a shareable card. The card is a
-- snapshot (headline, pull quote, Blame line, both portraits composed with their overlays at that moment,
-- any Trophy), because portraits change later and an old card must not. Built in TS by the create-clipping
-- Edge Function (the portrait compositor and the pull-quote rule live in @orc/content / @orc/sim), which is
-- the only writer. Readable by every member of the world.

create table clippings (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references worlds (id),
  player_id uuid not null references players (id), -- who clipped it
  story_no bigint not null, -- the story head
  edition_id uuid references editions (id), -- the edition it was cut from
  snapshot jsonb not null, -- ClippingSnapshot (@orc/sim clipping.ts), never updated
  created_at timestamptz not null,
  foreign key (world_id, story_no) references facts (world_id, no)
);
create index clippings_world_idx on clippings (world_id, created_at desc);

-- Frozen: nobody rewrites a card after the fact (not even the service role).
create function clippings_frozen() returns trigger language plpgsql as $$
begin
  raise exception 'clippings are frozen';
end;
$$;
create trigger clippings_no_update before update on clippings for each row execute function clippings_frozen();

alter table clippings enable row level security;
revoke all on clippings from anon, authenticated;
grant select on clippings to authenticated;
create policy clippings_member_read on clippings for select to authenticated using (is_world_member(world_id));

-- ---------------------------------------------------------------- the Hall's Clippings shelf (§4.3)

-- Newest first, like every Hall view, with who clipped it. Players are member-readable, so invoker rights.
create view hall_clippings with (security_invoker = true) as
  select c.world_id, c.id as clipping_id, c.story_no as fact_no, c.created_at as at, c.snapshot->>'kind' as kind,
         c.snapshot->>'headline' as caption, c.snapshot, p.display_name as clipped_by
  from clippings c
  join players p on p.id = c.player_id
  order by c.created_at desc, c.id desc;

-- The timeline gains the Clippings branch (#40 left `clipping_id` as its slot; the column list is unchanged).
-- A Clipping sits at the time it was clipped.
create or replace view hall_timeline with (security_invoker = true) as
  select t.* from (
    select world_id, 'legend'::text as shelf, fact_no, captain_id, at, kind, caption, comedy_weight,
           null::uuid as clipping_id
    from hall_legends
    union all
    select world_id, 'moment', fact_no, null, at, kind, caption, comedy_weight, null
    from hall_moments
    union all
    select world_id, 'clipping', story_no, null, created_at, snapshot->>'kind', snapshot->>'headline', null, id
    from clippings
  ) t
  order by t.at desc, t.fact_no desc, t.shelf;

revoke all on hall_clippings from anon, authenticated;
grant select on hall_clippings to authenticated;
