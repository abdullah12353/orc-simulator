-- #36 Backing and gold (data-model.md §1.4; Backing economy #8: D33–D36): Stakes, the gold ledger, the
-- public `backers` view, and the `back` / `withdraw` branch of submit_intent. Gold is private (decision 7):
-- amounts, gold and the ledger are owner-only; who backs whom is public, without amounts.

-- A Player's standing Stake on a Captain. Held through his death ("held" = captains.roster = 'dead').
-- Written by the tick only (the sim applies back/withdraw intents); 0 deletes the row.
create table stakes (
  world_id uuid not null references worlds (id),
  player_id uuid not null references players (id),
  captain_id text not null,
  amount int not null check (amount >= 1),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (player_id, captain_id),
  foreign key (world_id, captain_id) references captains (world_id, id)
);
-- Who backs a Captain (the Clash edge, the `backers` view, and pushes to a Player's Stable in #42).
create index stakes_captain_idx on stakes (world_id, captain_id);

-- Every change to a Player's gold. `player_private.gold` is its running total (from the 30 a Player
-- starts with). Debits (stake, top_up) are written by submit_intent; the tick writes the credits.
create table gold_ledger (
  id bigint generated always as identity primary key,
  world_id uuid not null references worlds (id),
  player_id uuid not null references players (id),
  delta int not null,
  lost int not null default 0 check (lost >= 0), -- overflow over the 30 cap
  reason text not null check (reason in ('stipend', 'stake', 'top_up', 'withdraw', 'payout_win', 'payout_infamy', 'refund')),
  fact_no bigint, -- the story head a payout is for (a Clash for a win)
  captain_id text,
  at timestamptz not null
);
create index gold_ledger_player_idx on gold_ledger (player_id, at);

alter table stakes enable row level security;
alter table gold_ledger enable row level security;
revoke all on stakes, gold_ledger from anon, authenticated;
grant select on stakes, gold_ledger to authenticated;
create policy stakes_owner_read on stakes for select to authenticated using (owns_player(player_id));
create policy gold_ledger_owner_read on gold_ledger for select to authenticated using (owns_player(player_id));

-- Who backs whom, without amounts, for members of the world. Runs as its owner (security_invoker off),
-- so it reads past the owner-only policy on `stakes`, and filters to the caller's worlds itself.
create view backers with (security_invoker = false) as
  select s.world_id, s.player_id, s.captain_id
  from stakes s join players p on p.id = s.player_id and p.removed_at is null
  where is_world_member(s.world_id);
revoke all on backers from anon, authenticated;
grant select on backers to authenticated;

-- The back / withdraw half of submit_intent: called by it with the caller's Player row already locked
-- and the id already checked for a replay. A `back` (new Stake or top-up) debits the gold at once, with
-- a ledger row; a `withdraw` debits nothing (the tick pays half back). Not callable by clients.
-- Fails with: bad_stake, not_enough_gold, no_stake.
create function submit_backing_intent(me uuid, id uuid, world_id uuid, kind text, payload jsonb)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  p jsonb := coalesce(payload, '{}'::jsonb);
  captain text := case when jsonb_typeof(p->'captainId') = 'string' then p->>'captainId' end;
  amount int;
  gold_ int;
  staked boolean;
begin
  if captain is null or not exists (
    select 1 from captains c where c.world_id = submit_backing_intent.world_id and c.id = captain
  ) then
    raise exception 'bad_stake' using errcode = 'P0001', detail = 'Back a Captain in this world.';
  end if;
  staked := exists (select 1 from stakes s where s.player_id = me and s.captain_id = captain)
    or exists (select 1 from intents i where i.player_id = me and i.status = 'queued' and i.kind = 'back'
               and i.payload->>'captainId' = captain);

  if kind = 'withdraw' then
    if not staked then
      raise exception 'no_stake' using errcode = 'P0001', detail = 'You have no Stake on that Captain.';
    end if;
    insert into intents (id, world_id, player_id, kind, payload, created_at, status)
    values (submit_backing_intent.id, submit_backing_intent.world_id, me, 'withdraw',
            jsonb_build_object('kind', 'withdraw', 'captainId', captain), now(), 'queued');
    return;
  end if;

  if jsonb_typeof(p->'amount') is distinct from 'number' or (p->>'amount')::numeric <> trunc((p->>'amount')::numeric)
     or (p->>'amount')::numeric < 1 then
    raise exception 'bad_stake' using errcode = 'P0001', detail = 'A Stake is a whole number of gold, at least 1.';
  end if;
  if (p->>'amount')::numeric > 30 then
    raise exception 'not_enough_gold' using errcode = 'P0001', detail = 'You have not got that much gold.';
  end if;
  amount := (p->>'amount')::int;
  select pp.gold into gold_ from player_private pp where pp.player_id = me;
  if amount > gold_ then
    raise exception 'not_enough_gold' using errcode = 'P0001', detail = 'You have not got that much gold.';
  end if;

  insert into intents (id, world_id, player_id, kind, payload, created_at, status)
  values (submit_backing_intent.id, submit_backing_intent.world_id, me, 'back',
          jsonb_build_object('kind', 'back', 'captainId', captain, 'amount', amount), now(), 'queued');
  update player_private pp set gold = pp.gold - amount where pp.player_id = me;
  insert into gold_ledger (world_id, player_id, delta, lost, reason, captain_id, at)
  values (submit_backing_intent.world_id, me, -amount, 0, case when staked then 'top_up' else 'stake' end, captain, now());
end;
$$;
revoke all on function submit_backing_intent(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;

-- submit_intent, as #35 left it (dispatching on kind with IF/ELSIF), plus one branch: `back` and
-- `withdraw` go to submit_backing_intent and debit no Meddle (marked "#36" below). Fails with:
-- not_a_player, intent_id_taken, unsupported_kind, bad_rumour, bad_dare, no_meddles_left, bad_stake,
-- not_enough_gold, no_stake.
create or replace function submit_intent(id uuid, world_id uuid, kind text, payload jsonb)
returns table (intent_id uuid, meddles_left int)
language plpgsql volatile security definer set search_path = public
as $$
declare
  me uuid := my_player(submit_intent.world_id);
  left_ int;
  prior intents;
  p jsonb := coalesce(submit_intent.payload, '{}'::jsonb);
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

  if submit_intent.kind = 'rumour' then
    clean := clean_rumour_payload(p);
  elsif submit_intent.kind = 'dare' then
    clean := clean_dare_payload(p);
  elsif submit_intent.kind in ('back', 'withdraw') then
    -- #36: Backing spends gold, not a Meddle.
    perform submit_backing_intent(me, submit_intent.id, submit_intent.world_id, submit_intent.kind, p);
    return query select submit_intent.id, left_;
    return;
  else
    raise exception 'unsupported_kind' using errcode = 'P0001', detail = 'That kind of intent is not open yet.';
  end if;

  if left_ < 1 then
    raise exception 'no_meddles_left' using errcode = 'P0001', detail = 'No Meddles left today.';
  end if;

  insert into intents (id, world_id, player_id, kind, payload, created_at, status)
  values (submit_intent.id, submit_intent.world_id, me, submit_intent.kind, clean, now(), 'queued');
  update player_private pp set meddles_available = pp.meddles_available - 1
  where pp.player_id = me
  returning pp.meddles_available into left_;
  return query select submit_intent.id, left_;
end;
$$;
