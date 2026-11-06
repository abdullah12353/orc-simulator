-- #38 The generated Herald (data-model §1.5, §3 step 10). open-edition writes one `herald` job per new
-- edition with stories to write, in the edition's own transaction, and runs it straight after: it is the
-- outbox row and the failure log, like a Clash job. The tick's drain never takes Herald jobs.

alter table narration_jobs
  add constraint narration_jobs_herald_edition check ((kind = 'herald') = (edition_id is not null));

-- At most one Herald job (so at most one model call) per edition.
create unique index narration_jobs_herald_uq on narration_jobs (edition_id) where kind = 'herald';
