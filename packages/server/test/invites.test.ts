// #25 Invites and joining: create/revoke invites, join_world(token, name) and the RLS split between
// public `players` and owner-only `player_private`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Sql } from '@orc/server';
import { asUser, asUserCommitted, db, fakeClock, freshWorld, newUser } from './support.ts';

async function createInvite(userId: string, worldId: string): Promise<string> {
  const [row] = await asUserCommitted(userId, (tx) => tx`select token from create_invite(${worldId})`);
  return row!.token as string;
}

async function join(userId: string, token: string, name: string): Promise<string> {
  const [row] = await asUserCommitted(userId, (tx) => tx`select join_world(${token}, ${name}) as id`);
  return row!.id as string;
}

test('a friend joins through an invite and appears as a Player under the name they picked', async () => {
  const { worldId, userId: creator } = await freshWorld({ clock: fakeClock() });
  const token = await createInvite(creator, worldId);
  assert.match(token, /^[0-9a-f]{32}$/, 'a 128-bit token');

  const friend = await newUser();
  const playerId = await join(friend, token, '  Dazza ');

  const players = await asUser(creator, (tx) => tx`select id, display_name from players where world_id = ${worldId}`);
  assert.deepEqual(players.map((p) => p.display_name).sort(), ['Dazza', 'Mo']);
  assert.ok(players.some((p) => p.id === playerId));
  const worlds = await asUser(friend, (tx) => tx`select name from worlds where id = ${worldId}`);
  assert.deepEqual(worlds.map((w) => w.name), ['Test Fortress'], 'the new Player can read the world');
});

test('an invite lasts 7 days and can be reused', async () => {
  const { worldId, userId: creator } = await freshWorld({ clock: fakeClock() });
  const token = await createInvite(creator, worldId);
  const [inv] = await db()`select extract(epoch from expires_at - created_at)::int as secs from invites where token = ${token}`;
  assert.equal(inv!.secs, 7 * 24 * 3600);

  await join(await newUser(), token, 'One');
  await join(await newUser(), token, 'Two');
  const [n] = await db()`select count(*)::int as n from players where world_id = ${worldId}`;
  assert.equal(n!.n, 3);
});

async function inviteStatus(userId: string, token: string): Promise<string> {
  const [row] = await asUser(userId, (tx) => tx`select status from invite_info(${token})`);
  return row!.status as string;
}

const failsWith = (reason: string) => (e: unknown) => {
  assert.equal((e as Error).message, reason);
  return true;
};

test('joining with an expired invite fails with a clear reason', async () => {
  const { worldId, userId: creator } = await freshWorld({ clock: fakeClock() });
  const token = await createInvite(creator, worldId);
  await db()`update invites set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where token = ${token}`;

  const friend = await newUser();
  assert.equal(await inviteStatus(friend, token), 'expired');
  await assert.rejects(join(friend, token, 'Late'), failsWith('invite_expired'));
});

test('a revoked invite stops working for any new friend, with a clear reason', async () => {
  const { worldId, userId: creator } = await freshWorld({ clock: fakeClock() });
  const token = await createInvite(creator, worldId);
  await join(await newUser(), token, 'Early');
  await asUserCommitted(creator, (tx) => tx`select revoke_invite(${token})`);

  const friend = await newUser();
  assert.equal(await inviteStatus(friend, token), 'revoked');
  await assert.rejects(join(friend, token, 'Leaker'), failsWith('invite_revoked'));
  await assert.rejects(join(friend, 'f'.repeat(32), 'Guesser'), failsWith('invite_not_found'));
});

test('a world holds at most 8 Players: the 9th is told the world is full', async () => {
  const { worldId, userId: creator } = await freshWorld({ clock: fakeClock() });
  const token = await createInvite(creator, worldId);
  for (let i = 2; i <= 8; i++) await join(await newUser(), token, `Friend ${i}`);

  const ninth = await newUser();
  assert.equal(await inviteStatus(ninth, token), 'full');
  await assert.rejects(join(ninth, token, 'Ninth'), failsWith('world_full'));
  const [n] = await db()`select count(*)::int as n from players where world_id = ${worldId}`;
  assert.equal(n!.n, 8);
});

test('two friends racing for the last seat: only one gets it', async () => {
  const { worldId, userId: creator } = await freshWorld({ clock: fakeClock() });
  const token = await createInvite(creator, worldId);
  for (let i = 2; i <= 7; i++) await join(await newUser(), token, `Friend ${i}`);

  const [a, b] = [await newUser(), await newUser()];
  const results = await Promise.allSettled([join(a, token, 'Racer A'), join(b, token, 'Racer B')]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  const [n] = await db()`select count(*)::int as n from players where world_id = ${worldId}`;
  assert.equal(n!.n, 8);
});

test('the same user cannot join one world twice', async () => {
  const { worldId, userId: creator } = await freshWorld({ clock: fakeClock() });
  const token = await createInvite(creator, worldId);
  const friend = await newUser();
  await join(friend, token, 'Dazza');

  assert.equal(await inviteStatus(friend, token), 'member');
  await assert.rejects(join(friend, token, 'Dazza Again'), failsWith('already_joined'));
  await assert.rejects(join(creator, token, 'Mo Again'), failsWith('already_joined'), 'not even the creator');
  const [n] = await db()`select count(*)::int as n from players where world_id = ${worldId}`;
  assert.equal(n!.n, 2);
});

test('a joining friend picks a display name of 1–40 characters that nobody else in the world uses', async () => {
  const { worldId, userId: creator } = await freshWorld({ clock: fakeClock() });
  const token = await createInvite(creator, worldId);
  const friend = await newUser();
  await assert.rejects(join(friend, token, '   '), failsWith('bad_display_name'));
  await assert.rejects(join(friend, token, 'x'.repeat(41)), failsWith('bad_display_name'));
  await assert.rejects(join(friend, token, ' mo '), failsWith('display_name_taken'), 'the creator is already Mo');
  await join(friend, token, 'Dazza');
});

test("a Player reads their own player_private row and never another Player's", async () => {
  const { worldId, playerId: creatorPlayer, userId: creator } = await freshWorld({ clock: fakeClock() });
  const token = await createInvite(creator, worldId);
  const friend = await newUser();
  const friendPlayer = await join(friend, token, 'Dazza');

  const mine = await asUser(friend, (tx) => tx`select player_id from player_private`);
  assert.deepEqual(mine.map((r) => r.player_id), [friendPlayer]);
  const theirs = await asUser(friend, (tx) => tx`select * from player_private where player_id = ${creatorPlayer}`);
  assert.equal(theirs.length, 0);
  const creatorSees = await asUser(creator, (tx) => tx`select player_id from player_private`);
  assert.deepEqual(creatorSees.map((r) => r.player_id), [creatorPlayer], 'the creator reads only his own');

  await assert.rejects(
    asUser(friend, (tx) => tx`update player_private set meddles_available = 6 where player_id = ${friendPlayer}`),
    /permission denied/,
    'resources only change through RPCs and the tick',
  );
});

test("a user outside the world can't read any of its rows, nor touch its invites", async () => {
  const { worldId, userId: creator } = await freshWorld({ clock: fakeClock() });
  const token = await createInvite(creator, worldId);
  await join(await newUser(), token, 'Dazza');

  const outsider = await newUser();
  await asUser(outsider, async (tx) => {
    assert.equal((await tx`select 1 from worlds where id = ${worldId}`).length, 0);
    for (const table of ['players', 'captains', 'facts', 'invites']) {
      const rows = await tx`select 1 from ${tx(table)} where world_id = ${worldId}`;
      assert.equal(rows.length, 0, `outsider reads no ${table}`);
    }
    assert.equal((await tx`select 1 from player_private`).length, 0);
  });
  await assert.rejects(asUserCommitted(outsider, (tx) => tx`select create_invite(${worldId})`), failsWith('not_a_player'));
  await assert.rejects(asUserCommitted(outsider, (tx) => tx`select revoke_invite(${token})`), failsWith('invite_not_found'));
  assert.equal(await inviteStatus(await newUser(), token), 'ok', 'the outsider could not revoke it');
});

test('the creator has no powers beyond any other Player', async () => {
  const { worldId, playerId: creatorPlayer, userId: creator } = await freshWorld({ clock: fakeClock() });
  const creatorToken = await createInvite(creator, worldId);
  const friend = await newUser();
  const friendPlayer = await join(friend, creatorToken, 'Dazza');

  // The same starting resources: 30 gold and 3 Meddles each.
  const start = (p: string) => db()`select gold, meddles_available::int as meddles from player_private where player_id = ${p}`;
  assert.deepEqual([...(await start(creatorPlayer))], [{ gold: 30, meddles: 3 }]);
  assert.deepEqual([...(await start(friendPlayer))], [{ gold: 30, meddles: 3 }]);

  // Any Player can invite, and revoke any invite, the creator's included.
  const friendToken = await createInvite(friend, worldId);
  await join(await newUser(), friendToken, 'Gaz');
  await asUserCommitted(friend, (tx) => tx`select revoke_invite(${creatorToken})`);
  assert.equal(await inviteStatus(await newUser(), creatorToken), 'revoked');

  // Nobody, the creator included, writes world state, other Players or invites directly.
  const writes: ((tx: Sql) => Promise<unknown>)[] = [
    (tx) => tx`update worlds set name = 'Mine now' where id = ${worldId}`,
    (tx) => tx`update captains set power = 10 where world_id = ${worldId}`,
    (tx) => tx`delete from players where id = ${friendPlayer}`,
    (tx) => tx`update invites set revoked_at = null where token = ${creatorToken}`,
    (tx) => tx`insert into invites (token, world_id, created_by, expires_at) values (${'a'.repeat(32)}, ${worldId}, ${creatorPlayer}, now() + interval '1 year')`,
  ];
  for (const write of writes) await assert.rejects(asUser(creator, write), /permission denied/);
});
