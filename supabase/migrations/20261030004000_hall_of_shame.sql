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
