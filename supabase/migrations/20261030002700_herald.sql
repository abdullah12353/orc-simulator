-- #27 The templated Herald (data-model.md §1.6, §4.1): each Player's editions of The Gutter Herald and
-- their ranked stories. Owner-only, written only by the open-edition Edge Function, kept forever
-- (decision 14; the PWA shows the last 7).

create table editions (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references worlds (id),
  player_id uuid not null references players (id),
  no int not null check (no >= 1), -- per Player
  covers_from timestamptz not null,
  covers_to timestamptz not null,
  created_at timestamptz not null,
  masthead jsonb not null, -- orc date, price gag, weather
  accusation_fact bigint, -- the Accusation pull quote (a later ticket)
  stable jsonb, -- the frozen "Your Stable" (a later ticket)
  status text not null default 'templated' check (status in ('templated', 'generated')),
  unique (player_id, no),
  check (covers_to >= covers_from)
);
create index editions_world_idx on editions (world_id, player_id, no desc);

create table edition_stories (
  edition_id uuid not null references editions (id),
  rank smallint not null check (rank between 1 and 28),
  story_no bigint not null,
  slot text not null check (slot in ('lead', 'headline', 'gutter')),
  headline text not null, -- the template line until the Herald job overwrites it
  standfirst text,
  body text,
  blame_line text, -- always templated (D53)
  primary key (edition_id, rank),
  check ((slot = 'lead') = (rank = 1) and (slot = 'gutter') = (rank >= 9))
);

alter table editions enable row level security;
alter table edition_stories enable row level security;

revoke all on editions, edition_stories from anon, authenticated;
grant select on editions, edition_stories to authenticated;

create policy editions_owner_read on editions for select to authenticated using (owns_player(player_id));
create policy edition_stories_owner_read on edition_stories for select to authenticated
  using (exists (select 1 from editions e where e.id = edition_id and owns_player(e.player_id)));
