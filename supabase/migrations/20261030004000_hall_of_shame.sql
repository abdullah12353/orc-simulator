-- #40 The Hall of Shame (data-model §4.2, §4.3, §4.5; D16, D55): a view over the event log, not a system.
-- It keeps the best idiocy forever, in time order and NEVER ranked: every shelf, Captain story, the
-- timeline and the rap sheet come back newest first. Replays read clash_dialogue (no model call).

-- ---------------------------------------------------------------- captions

-- The story's latest printed headline (a generated one where the Herald job wrote it), else null. Editions
-- are owner-only, so this reads them as definer, for world members only. A gutter entry prints only the
-- line, so a headline slot wins over a later gutter one.
create function story_caption(w uuid, story bigint) returns text
language sql stable security definer set search_path = public
as $$
  select es.headline
  from edition_stories es join editions e on e.id = es.edition_id
  where e.world_id = w and es.story_no = story and is_world_member(w)
  order by es.slot = 'gutter', e.created_at desc, e.no desc
  limit 1;
$$;
revoke all on function story_caption(uuid, bigint) from public, anon;
grant execute on function story_caption(uuid, bigint) to authenticated, service_role;
create index edition_stories_story_idx on edition_stories (story_no);

-- ---------------------------------------------------------------- rap sheets (§4.2)

-- One Player's rap sheet: the 10 heaviest story heads they're blamed for, re-sorted by time for display.
-- A function of ONE Player, not the `rap_sheets` view data-model §1.6 lists (a view would hand back every
-- Player's sheet in one request, which D18 rules out). Anyone in that Player's world can read it.
create function rap_sheet(p_player uuid)
returns table (fact_no bigint, at timestamptz, kind text, comedy_weight smallint, hops smallint, caption text, "cast" text[])
language sql stable security invoker set search_path = public
as $$
  with blamed as (
    select distinct on (f.no) f.world_id, f.no, f.at, f.kind, f.comedy_weight, b.hops, f.line, f."cast"
    from fact_blame b
    join facts f on f.world_id = b.world_id and f.no = b.fact_no
    where b.player_id = p_player and f.no = f.story_no and f.tier <> 'silent'
    order by f.no, b.hops
  ), heaviest as (
    select * from blamed order by coalesce(comedy_weight, 0) desc, at desc, no desc limit 10
  )
  select h.no, h.at, h.kind, h.comedy_weight, h.hops, coalesce(story_caption(h.world_id, h.no), h.line), h."cast"
  from heaviest h
  order by h.at desc, h.no desc;
$$;
revoke all on function rap_sheet(uuid) from public, anon;
grant execute on function rap_sheet(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- shelves (§4.3)

-- Plain views over member-readable tables, so security_invoker: RLS filters them to the caller's worlds.
-- Each has its ORDER BY (newest first; ties: the later Fact first), and the PWA asks for the same order.

-- Legends: every Captain who has gone Legendary, with the deed that took him over 150 Infamy.
create view hall_legends with (security_invoker = true) as
  select c.world_id, c.id as captain_id, f.no as fact_no, f.at, f.kind, f.line, f.comedy_weight, f."cast",
         coalesce(story_caption(f.world_id, f.no), f.line) as caption
  from captains c
  join facts f on f.world_id = c.world_id and f.no = c.legendary_fact
  order by f.at desc, f.no desc, c.id;

-- Infamous moments: story heads with comedy weight 20+ (the facts_moments_idx partial index).
create view hall_moments with (security_invoker = true) as
  select f.world_id, f.no as fact_no, f.at, f.kind, f.line, f.comedy_weight, f."cast",
         coalesce(story_caption(f.world_id, f.no), f.line) as caption
  from facts f
  where f.comedy_weight >= 20 and f.no = f.story_no and f.tier <> 'silent'
  order by f.at desc, f.no desc;

-- A Captain's story: his deaths, Returns, Humiliations (Epithets are a Humiliation category), Trophies
-- won and lost, and his Legendary moment. Silent Facts have no line of their own, so the head's line
-- comes along, and the PWA renders the rest from the payload.
create view captain_story with (security_invoker = true) as
  select f.world_id, c.id as captain_id, f.no as fact_no, f.at, f.kind, f.story_no, f.line, f.payload,
         h.line as story_line
  from captains c
  join facts f on f.world_id = c.world_id and f."cast" @> array[c.id]
  join facts h on h.world_id = f.world_id and h.no = f.story_no
  where f.kind in ('death', 'return', 'humiliation', 'trophy', 'legendary')
  order by f.at desc, f.no desc;

-- The timeline: the shelves merged by time. A Legendary deed heavy enough to be a moment is on both
-- shelves, so it comes twice (legend first). #41 adds the Clippings shelf as a third branch, keeping
-- this column list (clipping_id is its slot), e.g.
--   union all select world_id, 'clipping', story_no, null, created_at, null, <headline>, null, id from clippings
create view hall_timeline with (security_invoker = true) as
  select t.* from (
    select world_id, 'legend'::text as shelf, fact_no, captain_id, at, kind, caption, comedy_weight,
           null::uuid as clipping_id
    from hall_legends
    union all
    select world_id, 'moment', fact_no, null, at, kind, caption, comedy_weight, null
    from hall_moments
  ) t
  order by t.at desc, t.fact_no desc, t.shelf;

revoke all on hall_legends, hall_moments, captain_story, hall_timeline from anon, authenticated;
grant select on hall_legends, hall_moments, captain_story, hall_timeline to authenticated;

-- ---------------------------------------------------------------- trace it back (§4.5)

-- "The story of how": walks up the causal DAG (fact_causes) from a Fact, at most 6 hops (the hop cap,
-- BLAME.hopCap in @orc/sim, decision 8c), and returns each step once, at its nearest hop, in causal order
-- (oldest first, ending at the Fact itself). Silent steps have no line, so each brings its story's line.
-- Who is to blame is never recomputed here: that is fact_blame. Members only, through RLS on facts.
create function trace_back(p_world uuid, p_fact bigint)
returns table (fact_no bigint, hops int, at timestamptz, kind text, line text, story_no bigint, story_line text,
               "cast" text[], payload jsonb)
language sql stable security invoker set search_path = public
as $$
  with recursive up (no, hops) as (
    select f.no, 0 from facts f where f.world_id = p_world and f.no = p_fact
    union
    select c.cause_no, up.hops + 1
    from up join fact_causes c on c.world_id = p_world and c.fact_no = up.no
    where up.hops < 6
  ), steps as (
    select no, min(hops) as hops from up group by no
  )
  select f.no, s.hops, f.at, f.kind, f.line, f.story_no, h.line, f."cast", f.payload
  from steps s
  join facts f on f.world_id = p_world and f.no = s.no
  join facts h on h.world_id = p_world and h.no = f.story_no
  order by f.at, f.no;
$$;
revoke all on function trace_back(uuid, bigint) from public, anon;
grant execute on function trace_back(uuid, bigint) to authenticated, service_role;
