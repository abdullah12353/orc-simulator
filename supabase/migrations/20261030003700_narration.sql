-- #37 Generated Clash dialogue (data-model §1.5, §3 step 7). The narration outbox, which is also the
-- failure log, and the global per-provider usage counter. Both are service-only: no client grants.

create type job_status as enum ('queued', 'done', 'fallback');

create table narration_jobs (
  id bigint generated always as identity primary key,
  world_id uuid not null references worlds (id),
  kind text not null check (kind in ('clash', 'herald')),
  fact_no bigint,
  edition_id uuid references editions (id),
  status job_status not null default 'queued',
  provider text, -- the last provider called: workers-ai, groq (null when no call was made)
  failure text check (failure in ('refusal', 'timeout', 'bad_output', 'quota')),
  excerpt text, -- what came back (or what went wrong), cut short
  neurons int, -- Workers AI only, from returned usage × the rate table in code
  tokens int,
  created_at timestamptz not null,
  -- Not in data-model §1.5: set when a drain takes the job, so two overlapping drains never both call
  -- a model for it. A claimed job that never finishes stays queued and keeps its fallback (no retries).
  claimed_at timestamptz,
  finished_at timestamptz,
  foreign key (world_id, fact_no) references facts (world_id, no),
  check ((kind = 'clash') = (fact_no is not null))
);
-- What a drain looks for: a world's unclaimed queued jobs, oldest first.
create index narration_jobs_queued on narration_jobs (world_id, id) where status = 'queued' and claimed_at is null;
-- At most one Clash job per Clash.
create unique index narration_jobs_clash_uq on narration_jobs (world_id, fact_no) where kind = 'clash';

-- The Neuron (and token) counter. Global: quotas are per provider account, not per world. `day` is the
-- UTC date, the providers' reset. Reserved before a call with an atomic conditional UPDATE … RETURNING,
-- then settled to the usage the provider reported.
create table llm_usage (
  day date not null,
  provider text not null,
  neurons int not null default 0,
  requests int not null default 0,
  tokens int not null default 0,
  primary key (day, provider)
);

alter table narration_jobs enable row level security;
alter table llm_usage enable row level security;
revoke all on narration_jobs, llm_usage from anon, authenticated;
