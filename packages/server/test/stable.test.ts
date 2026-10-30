// #36 "Your Stable" (data-model §4.1): each edition freezes the reader's private section (gold changes in
// its window, Stakes, Meddles landed and pending, current gold and Meddles) into `editions.stable`.
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openEdition } from '@orc/server';
import { asUser, asUserCommitted, db, fakeClock, freshWorld, insertStoryFacts } from './support.ts';

const at = (from: string, minutes: number) => new Date(Date.parse(from) + minutes * 60_000).toISOString();

test('"Your Stable" is frozen into the edition and does not change later', async () => {
  const clock = fakeClock();
  const t0 = clock.iso();
  const world = await freshWorld({ clock });
  const [krug, gob] = (await db()<{ id: string }[]>`select id from captains where world_id = ${world.worldId} order by id`).map((c) => c.id);

  // A Stake on each, Gob dead (held); a Rumour queued; one payout inside the window and one before it.
  await db()`
    insert into stakes (world_id, player_id, captain_id, amount, created_at, updated_at)
    values (${world.worldId}, ${world.playerId}, ${krug!}, 10, ${t0}, ${t0}), (${world.worldId}, ${world.playerId}, ${gob!}, 4, ${t0}, ${t0})`;
  await db()`update captains set roster = 'dead', returns_at = ${at(t0, 3000)} where world_id = ${world.worldId} and id = ${gob!}`;
  const [drowned] = await insertStoryFacts(world.worldId, t0, [{ minute: 10, line: 'Krúg drowned in 30cm of moat.' }]);
  await db()`
    insert into gold_ledger (world_id, player_id, delta, lost, reason, fact_no, captain_id, at) values
      (${world.worldId}, ${world.playerId}, 3, 0, 'payout_win', null, ${krug!}, ${at(t0, -60 * 25)}),
      (${world.worldId}, ${world.playerId}, 8, 0, 'payout_infamy', ${drowned!}, ${krug!}, ${at(t0, 10)}),
      (${world.worldId}, ${world.playerId}, 5, 5, 'stipend', null, null, ${at(t0, 11)})`;
  await db()`update player_private set gold = 22, meddles_available = 2 where player_id = ${world.playerId}`;
  const [source, target] = (await db()<{ id: string; traits: string[] }[]>`
    select id, traits from captains where world_id = ${world.worldId} and roster = 'active' order by id limit 2`);
  await asUserCommitted(world.userId, (tx) =>
    tx`select submit_intent(${randomUUID()}, ${world.worldId}, 'rumour', ${tx.json({
      source: source!.id, target: target!.id, claim: 'insult', subject: { from: 'trait', key: target!.traits[0]! },
    })})`);

  clock.advance(20);
  const first = await openEdition({ sql: db(), now: clock.now }, { userId: world.userId, worldId: world.worldId });
  assert.equal(first.created, true);
  const stable = first.edition.stable;
  assert.equal(stable!.gold, 22);
  assert.equal(stable!.meddles, 1, 'after the Rumour was debited');
  assert.equal(stable!.pendingMeddles, 1);
  assert.deepEqual(stable!.meddlesLanded, []);
  assert.deepEqual(stable!.stakes, [
    { captainId: [krug!, gob!].sort()[0], amount: krug! < gob! ? 10 : 4, held: krug! > gob! },
    { captainId: [krug!, gob!].sort()[1], amount: krug! < gob! ? 4 : 10, held: krug! < gob! },
  ]);
  assert.deepEqual(
    stable!.goldChanges.map((g) => [g.delta, g.lost, g.reason, g.captainId, g.factNo, g.line]),
    [
      [8, 0, 'payout_infamy', krug, drowned, 'Krúg drowned in 30cm of moat.'],
      [5, 5, 'stipend', null, null, null],
    ],
    'only the window, oldest first, with the story line',
  );

  // Everything moves on; the printed edition doesn't.
  await db()`update player_private set gold = 30, meddles_available = 6 where player_id = ${world.playerId}`;
  await db()`delete from stakes where player_id = ${world.playerId}`;
  await db()`
    insert into gold_ledger (world_id, player_id, delta, lost, reason, at)
    values (${world.worldId}, ${world.playerId}, 8, 0, 'withdraw', ${at(t0, 15)})`;
  clock.advance(5);
  const again = await openEdition({ sql: db(), now: clock.now }, { userId: world.userId, worldId: world.worldId });
  assert.equal(again.created, false);
  assert.equal(again.edition.id, first.edition.id);
  assert.deepEqual(again.edition.stable, stable);
  const [stored] = await asUser(world.userId, (tx) => tx`select stable from editions where id = ${first.edition.id}`);
  assert.deepEqual(stored!.stable, stable, 'stored on the edition, readable by its owner');
});
