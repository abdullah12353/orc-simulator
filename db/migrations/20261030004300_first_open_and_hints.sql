-- #43 First open and hints (D58): the once-only first open (`first_open_at`), one-line hints recorded in
-- `hints_seen`, and submit_intent marking `first_meddle_done` the moment a Player's first Meddle is sent.

-- ---------------------------------------------------------------- begin_first_open

-- True exactly once per Player: the call that stamps `first_open_at`. The PWA plays the first-open
-- sequence (Krúg's Introduction, the edition, the guided Rumour) only when this returns true, so two
-- tabs can't both play it and it never repeats. Fails with: not_a_player.
create function begin_first_open(world_id uuid) returns boolean
language plpgsql volatile security definer set search_path = public
as $$
declare
  me uuid := my_player(begin_first_open.world_id);
  stamped boolean;
begin
  if me is null then
    raise exception 'not_a_player' using errcode = 'P0001', detail = 'Only a Player in this world can open it.';
  end if;
  update player_private pp set first_open_at = now()
  where pp.player_id = me and pp.first_open_at is null;
  stamped := found;
  return stamped;
end;
$$;
revoke all on function begin_first_open(uuid) from public, anon;
grant execute on function begin_first_open(uuid) to authenticated;

-- ---------------------------------------------------------------- see_hint

-- The caller met a hint (dare, backing, stable). True if this is the first time (show the one-liner),
-- false ever after. Fails with: not_a_player, bad_hint.
create function see_hint(world_id uuid, hint text) returns boolean
language plpgsql volatile security definer set search_path = public
as $$
declare
  me uuid := my_player(see_hint.world_id);
  fresh boolean;
begin
  if me is null then
    raise exception 'not_a_player' using errcode = 'P0001', detail = 'Only a Player in this world gets hints.';
  end if;
  if hint is null or hint not in ('dare', 'backing', 'stable') then
    raise exception 'bad_hint' using errcode = 'P0001', detail = 'No such hint.';
  end if;
  update player_private pp set hints_seen = pp.hints_seen || hint
  where pp.player_id = me and not (hint = any (pp.hints_seen));
  fresh := found;
  return fresh;
end;
$$;
revoke all on function see_hint(uuid, text) from public, anon;
grant execute on function see_hint(uuid, text) to authenticated;

-- ---------------------------------------------------------------- submit_intent

-- submit_intent, as #36 left it (rumour, dare, and back/withdraw), plus (marked "#43" below): a rumour or
-- dare sets `first_meddle_done` at once, and keeps its `firstMeddle` flag only if it really is the
-- Player's first Meddle (the tick un-marks that Player for the batch, so the sim gives it the 2–5 min
-- Fuse). Fails with: not_a_player, intent_id_taken, unsupported_kind, bad_rumour, bad_dare,
-- no_meddles_left, bad_stake, not_enough_gold, no_stake.
create or replace function submit_intent(id uuid, world_id uuid, kind text, payload jsonb)
returns table (intent_id uuid, meddles_left int)
language plpgsql volatile security definer set search_path = public
as $$
declare
  me uuid := my_player(submit_intent.world_id);
  left_ int;
  done_ boolean;
  prior intents;
  p jsonb := coalesce(submit_intent.payload, '{}'::jsonb);
  clean jsonb;
begin
  if me is null then
    raise exception 'not_a_player' using errcode = 'P0001', detail = 'Only a Player in this world can meddle.';
  end if;

  -- Serialises this Player's submits, and waits for a running tick (it holds this row until commit).
  select pp.meddles_available, pp.first_meddle_done into left_, done_
  from player_private pp where pp.player_id = me for update;

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

  -- #43: only a Player's real first Meddle keeps the flag (and so the short Fuse).
  clean := clean || jsonb_build_object('firstMeddle', (clean->>'firstMeddle')::boolean and not done_);

  insert into intents (id, world_id, player_id, kind, payload, created_at, status)
  values (submit_intent.id, submit_intent.world_id, me, submit_intent.kind, clean, now(), 'queued');
  update player_private pp set meddles_available = pp.meddles_available - 1,
                               first_meddle_done = true -- #43
  where pp.player_id = me
  returning pp.meddles_available into left_;
  return query select submit_intent.id, left_;
end;
$$;
