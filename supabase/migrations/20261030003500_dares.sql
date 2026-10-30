-- #35 Dares: submit_intent accepts kind 'dare' (a Stunt, or a Prank naming a victim; or 'surprise').
-- The tables already have room for Dares (meddles.dare_key, meddles.victim_id, meddle_verb 'dare').
-- Each kind's shape check lives in its own clean_<kind>_payload function, so submit_intent just dispatches;
-- Backing (#36) adds its kinds beside these.

-- A Rumour's payload, checked for shape and cleaned (unchanged from #28). Raises bad_rumour.
create function clean_rumour_payload(p jsonb)
returns jsonb
language plpgsql immutable set search_path = public
as $$
declare
  free text := nullif(btrim(coalesce(p->>'freeText', '')), '');
begin
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
  return jsonb_build_object(
    'kind', 'rumour',
    'source', p->>'source',
    'target', p->>'target',
    'claim', p->>'claim',
    'subject', jsonb_build_object('from', p->'subject'->>'from', 'key', p->'subject'->>'key'),
    'firstMeddle', coalesce((p->>'firstMeddle')::boolean, false)
  ) || case when free is null then '{}'::jsonb else jsonb_build_object('freeText', free) end;
end;
$$;

-- A Dare's payload: a target, a Dare key from the bank (or 'surprise'), and a victim for a Prank. Only shape
-- is checked here; the sim checks the key against the bundle and the Captains against the world, and
-- refunds a reject. Raises bad_dare.
create function clean_dare_payload(p jsonb)
returns jsonb
language plpgsql immutable set search_path = public
as $$
begin
  if jsonb_typeof(p->'target') is distinct from 'string'
     or jsonb_typeof(p->'dareKey') is distinct from 'string'
     or length(p->>'dareKey') not between 1 and 64
     or (p ? 'victim' and (jsonb_typeof(p->'victim') <> 'string' or p->>'victim' = p->>'target'))
     or (p ? 'firstMeddle' and jsonb_typeof(p->'firstMeddle') <> 'boolean') then
    raise exception 'bad_dare' using errcode = 'P0001', detail = 'A Dare needs a target and a Dare (and a different victim for a Prank).';
  end if;
  return jsonb_build_object(
    'kind', 'dare',
    'target', p->>'target',
    'dareKey', p->>'dareKey',
    'firstMeddle', coalesce((p->>'firstMeddle')::boolean, false)
  ) || case when p ? 'victim' then jsonb_build_object('victim', p->>'victim') else '{}'::jsonb end;
end;
$$;

revoke all on function clean_rumour_payload(jsonb), clean_dare_payload(jsonb) from public, anon, authenticated;

-- Queues a Meddle for the next tick and debits it at once, so the Player sees an honest "2 Meddles
-- left". Idempotent on the client-generated id: resubmitting returns the same result without a second
-- debit. Fails with: not_a_player, intent_id_taken, unsupported_kind, bad_rumour, bad_dare, no_meddles_left.
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
  else
    raise exception 'unsupported_kind' using errcode = 'P0001', detail = 'Only Rumours and Dares can be planted so far.';
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
