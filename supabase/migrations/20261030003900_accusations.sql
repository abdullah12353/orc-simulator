-- #39 Accusations (data-model.md §1.1, §4.1; D20, D59): a prerecorded clip of each accuser saying a
-- Player's mangled name. An accuser can only name a Player once the matching row exists, so late joiners
-- become accusable once rendered. The operator registers clips (`npm run names:register`, which calls
-- `registerNameRender` in packages/server); clients only read.

create table name_renders (
  player_id uuid not null references players (id),
  accuser_id text not null, -- one of the 6 accuser Captains (content bundle `accuser` flag)
  clip_key text not null check (length(btrim(clip_key)) > 0), -- storage (R2) path of the clip
  -- The mangled name the clip says (also in players.mangled_names). Not in data-model §1.1: the sim
  -- writes it into the Accusation's line.
  says text not null check (length(btrim(says)) > 0),
  rendered_at timestamptz not null default now(),
  primary key (player_id, accuser_id)
);

alter table name_renders enable row level security;
revoke all on name_renders from anon, authenticated;
grant select on name_renders to authenticated;
create policy name_renders_member_read on name_renders for select to authenticated
  using (exists (select 1 from players p where p.id = player_id and is_world_member(p.world_id)));

-- The Herald looks up a story's Accusations by story (§4.1).
create index facts_accusation_idx on facts (world_id, story_no) where kind = 'accusation';
