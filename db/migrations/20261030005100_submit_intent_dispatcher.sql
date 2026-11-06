-- submit_intent as a thin dispatcher (review fix). Every ticket that added a kind re-created its whole
-- body; now the body is the shared part only (who you are, the per-Player lock, the replay check) and
-- one line per kind, each handled by its own function, as `submit_backing_intent` already was:
--   rumour, dare     → submit_meddle_intent (spends a Meddle; keeps #43's first-Meddle lines)
--   back, withdraw   → submit_backing_intent (#36; spends gold, not a Meddle)
-- A later kind adds its function and ONE branch here (re-create this short function, keeping every
-- branch). Behaviour is unchanged. Fails with: not_a_player, intent_id_taken, unsupported_kind,
-- bad_rumour, bad_dare, no_meddles_left, bad_stake, not_enough_gold, no_stake.

-- A Rumour or a Dare, its payload already cleaned (clean_rumour_payload / clean_dare_payload), for `me`
-- whose player_private row the caller holds. Debits a Meddle and queues the Intent. #43: it sets
-- `first_meddle_done` at once, and the payload keeps `firstMeddle` only if this really is the Player's
-- first Meddle (the tick un-marks that Player for the batch, so the sim gives it the 2–5 min Fuse).
-- Returns the Meddles left. Not callable by clients. Fails with: no_meddles_left.
create function submit_meddle_intent(me uuid, id uuid, world_id uuid, kind text, clean jsonb)
returns int
language plpgsql volatile security definer set search_path = public
as $$
declare
  left_ int;
  done_ boolean;
begin
  select pp.meddles_available, pp.first_meddle_done into left_, done_
  from player_private pp where pp.player_id = me;
  if left_ < 1 then
    raise exception 'no_meddles_left' using errcode = 'P0001', detail = 'No Meddles left today.';
  end if;

  -- #43: only a Player's real first Meddle keeps the flag (and so the short Fuse).
  clean := clean || jsonb_build_object('firstMeddle', (clean->>'firstMeddle')::boolean and not done_);

  insert into intents (id, world_id, player_id, kind, payload, created_at, status)
  values (submit_meddle_intent.id, submit_meddle_intent.world_id, me, submit_meddle_intent.kind, clean, now(), 'queued');
  update player_private pp set meddles_available = pp.meddles_available - 1,
                               first_meddle_done = true -- #43
  where pp.player_id = me
  returning pp.meddles_available into left_;
  return left_;
end;
$$;
revoke all on function submit_meddle_intent(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;

create or replace function submit_intent(id uuid, world_id uuid, kind text, payload jsonb)
returns table (intent_id uuid, meddles_left int)
language plpgsql volatile security definer set search_path = public
as $$
declare
  me uuid := my_player(submit_intent.world_id);
  left_ int;
  prior intents;
  p jsonb := coalesce(submit_intent.payload, '{}'::jsonb);
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

  -- One branch per kind. Don't pick the cleaner with CASE: an immutable function with constant args can
  -- be folded at plan time and raise for the wrong kind (#35).
  if submit_intent.kind = 'rumour' then
    left_ := submit_meddle_intent(me, submit_intent.id, submit_intent.world_id, 'rumour', clean_rumour_payload(p));
  elsif submit_intent.kind = 'dare' then
    left_ := submit_meddle_intent(me, submit_intent.id, submit_intent.world_id, 'dare', clean_dare_payload(p));
  elsif submit_intent.kind in ('back', 'withdraw') then
    -- #36: Backing spends gold, not a Meddle.
    perform submit_backing_intent(me, submit_intent.id, submit_intent.world_id, submit_intent.kind, p);
  else
    raise exception 'unsupported_kind' using errcode = 'P0001', detail = 'That kind of intent is not open yet.';
  end if;
  return query select submit_intent.id, left_;
end;
$$;
