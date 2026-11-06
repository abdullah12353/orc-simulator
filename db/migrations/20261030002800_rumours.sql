-- #28 Rumours end to end (data-model.md §1.4): intents, meddles and fuses, and the submit_intent RPC.
-- Player ledgers are debited at submit (decision 4); world state changes only inside the sim's tick.

create type meddle_verb as enum ('rumour', 'dare');
create type meddle_status as enum ('pending', 'held', 'landed');
create type claim as enum ('insult', 'fear', 'theft', 'mum', 'coup');
create type intent_status as enum ('queued', 'consumed', 'rejected');

-- A Player's request, queued for the next tick. Inserted only through submit_intent.
create table intents (
  id uuid primary key, -- client-generated: resubmitting the same id is a no-op
  world_id uuid not null references worlds (id),
  player_id uuid not null references players (id),
  kind text not null check (kind in ('rumour', 'dare', 'back', 'withdraw')),
  payload jsonb not null, -- the Intent minus its envelope
  created_at timestamptz not null default now(),
  status intent_status not null default 'queued',
  consumed_tick bigint,
  reject_reason text
);
create index intents_queued_idx on intents (world_id, created_at) where status = 'queued';
create index intents_player_idx on intents (player_id, created_at desc);

-- A consumed Rumour or Dare. Secret until it lands (decision 7): only its Player reads it before then.
create table meddles (
  id uuid primary key references intents (id), -- = the intent id
  world_id uuid not null references worlds (id),
  player_id uuid not null references players (id),
  verb meddle_verb not null,
  target_id text not null,
  source_id text, -- Rumour
  victim_id text, -- Prank dare
  claim claim,
  subject jsonb,
  free_text text check (length(free_text) <= 200),
  dare_key text,
  created_at timestamptz not null,
  status meddle_status not null,
  held_on text, -- the dead target it waits for
  landed_fact bigint,
  check ((status = 'landed') = (landed_fact is not null)),
  foreign key (world_id, target_id) references captains (world_id, id)
);
create index meddles_world_idx on meddles (world_id, status);
create index meddles_player_idx on meddles (player_id, created_at desc);

-- The fuse queue: Meddle fuses (10–90 min; 2–5 for the guided first one) and, later, chain follow-ups.
-- Service only: a Fuse would give away a pending Meddle.
create table fuses (
  world_id uuid not null references worlds (id),
  no bigint not null, -- from the sim's per-world counter
  due_at timestamptz not null,
  kind text not null check (kind in ('meddle', 'reaction')),
  meddle_id uuid references meddles (id),
  template_id text,
  "cast" jsonb,
  parent_fact bigint,
  created_tick bigint not null,
  primary key (world_id, no),
  check ((kind = 'meddle') = (meddle_id is not null))
);
create index fuses_due_idx on fuses (world_id, due_at, no);

alter table intents enable row level security;
alter table meddles enable row level security;
alter table fuses enable row level security;

revoke all on intents, meddles, fuses from anon, authenticated;
grant select on intents, meddles to authenticated;

create policy intents_owner_read on intents for select to authenticated using (owns_player(player_id));
create policy meddles_owner_or_landed_read on meddles for select to authenticated
  using (owns_player(player_id) or (landed_fact is not null and is_world_member(world_id)));
-- fuses: service only (no policy, no grant).

-- Queues a Meddle for the next tick and debits it at once, so the Player sees an honest "2 Meddles
-- left". Idempotent on the client-generated id: resubmitting returns the same result without a second
-- debit. Only shape is checked here; the sim checks the Rumour against the world and refunds rejects.
-- Fails with: not_a_player, intent_id_taken, unsupported_kind, bad_rumour, no_meddles_left.
create function submit_intent(id uuid, world_id uuid, kind text, payload jsonb)
returns table (intent_id uuid, meddles_left int)
language plpgsql volatile security definer set search_path = public
as $$
declare
  me uuid := my_player(submit_intent.world_id);
  left_ int;
  prior intents;
  p jsonb := coalesce(submit_intent.payload, '{}'::jsonb);
  free text;
  clean jsonb;
begin
  if me is null then
    raise exception 'not_a_player' using errcode = 'P0001', detail = 'Only a Player in this world can meddle.';
  end if;

  -- Serialises this Player's submits, and waits for a running tick (it holds this row until commit).
  select pp.meddles_available into left_ from player_private pp where pp.player_id = me for update;

  select * into prior from intents i where i.id = submit_intent.id;
  if found then
    if prior.player_id <> me then
      raise exception 'intent_id_taken' using errcode = 'P0001', detail = 'That intent id belongs to someone else.';
    end if;
    return query select prior.id, left_;
    return;
  end if;

  if submit_intent.kind <> 'rumour' then
    raise exception 'unsupported_kind' using errcode = 'P0001', detail = 'Only Rumours can be planted so far.';
  end if;

  free := nullif(btrim(coalesce(p->>'freeText', '')), '');
  if jsonb_typeof(p->'source') is distinct from 'string' or jsonb_typeof(p->'target') is distinct from 'string'
     or p->>'source' = p->>'target'
     or coalesce(p->>'claim', '') not in ('insult', 'fear', 'theft', 'mum', 'coup')
     or jsonb_typeof(p->'subject') is distinct from 'object'
     or coalesce(p->'subject'->>'from', '') not in ('trait', 'fear', 'trophy')
     or jsonb_typeof(p->'subject'->'key') is distinct from 'string'
     or (p ? 'firstMeddle' and jsonb_typeof(p->'firstMeddle') <> 'boolean')
     or length(free) > 200 then
    raise exception 'bad_rumour' using errcode = 'P0001', detail = 'A Rumour needs a source, a target, a Claim and a subject.';
  end if;

  if left_ < 1 then
    raise exception 'no_meddles_left' using errcode = 'P0001', detail = 'No Meddles left today.';
  end if;

  clean := jsonb_build_object(
    'kind', 'rumour',
    'source', p->>'source',
    'target', p->>'target',
    'claim', p->>'claim',
    'subject', jsonb_build_object('from', p->'subject'->>'from', 'key', p->'subject'->>'key'),
    'firstMeddle', coalesce((p->>'firstMeddle')::boolean, false)
  ) || case when free is null then '{}'::jsonb else jsonb_build_object('freeText', free) end;

  insert into intents (id, world_id, player_id, kind, payload, created_at, status)
  values (submit_intent.id, submit_intent.world_id, me, 'rumour', clean, now(), 'queued');
  update player_private pp set meddles_available = pp.meddles_available - 1
  where pp.player_id = me
  returning pp.meddles_available into left_;
  return query select submit_intent.id, left_;
end;
$$;

revoke all on function submit_intent(uuid, uuid, text, jsonb) from public, anon;
grant execute on function submit_intent(uuid, uuid, text, jsonb) to authenticated;
