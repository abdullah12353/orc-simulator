// #68 The World DO's live sockets, driven under Node against this worktree's Postgres: workerd's socket
// and storage APIs are stood in by ./workerd (imported first, so `cloudflare:workers` resolves). Run
// through `npm run test:db`.
import { fakeState, lastPair, type FakeSocket } from './workerd/index.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUTTER, nextMonthStart, nextMinuteTick, WATCH } from '@orc/server';
import { AFTER_DAY_ZERO, asUserCommitted, db, DB_URL, fakeClock, freshWorld, newUser } from '../../../packages/server/test/support.ts';
import { USER_HEADER } from '../src/env.ts';

const { World, GUTTER_CLOSED_CODE, NOT_A_PLAYER_CODE } = await import('../src/world.ts');

/** Nothing listens here: a job that asks Postgres anything fails. */
const UNREACHABLE = 'postgresql://nobody:nothing@127.0.0.1:1/none';

/** The WORLDS namespace, in memory: only the usage guard's reading (#70) is read from it here. */
function fakeKV() {
  const data = new Map<string, string>();
  return {
    data,
    async get(key: string, type?: 'json') {
      const v = data.get(key);
      return v === undefined ? null : type === 'json' ? JSON.parse(v) : v;
    },
    async put(key: string, value: string) {
      data.set(key, value);
    },
  };
}

function worldDO(dbUrl = DB_URL) {
  const state = fakeState();
  const env = { NEON_DB_URL: dbUrl, WORLDS: fakeKV() };
  const w = new World(state as never, env as never);
  return { w, state, env };
}

/** The router's call for a socket: an upgrade with the verified user id. Returns the DO's end of it. */
async function open(w: InstanceType<typeof World>, worldId: string, userId: string | null) {
  const headers: Record<string, string> = { Upgrade: 'websocket' };
  if (userId) headers[USER_HEADER] = userId;
  const res = await w.fetch(new Request(`https://world/${worldId}/live`, { headers }));
  assert.equal(res.status, 101);
  return lastPair![1];
}

/** A world created `minutesAgo` minutes ago (real time: the DO runs on the real clock). */
async function worldAgo(minutesAgo: number) {
  return freshWorld({ clock: fakeClock(new Date(Date.now() - minutesAgo * 60_000).toISOString()) });
}

async function join(creator: string, worldId: string): Promise<string> {
  const [invite] = await asUserCommitted(creator, (tx) => tx`select token from create_invite(${worldId})`);
  const friend = await newUser();
  await asUserCommitted(friend, (tx) => tx`select join_world(${invite!.token}, 'Dazza')`);
  return friend;
}

const tickSeq = async (worldId: string) => (await db()`select tick_seq::int from worlds where id = ${worldId}`)[0]!.tick_seq as number;
const lastTick = async (worldId: string) =>
  (await db()`select seq::int, watched from ticks where world_id = ${worldId} order by seq desc limit 1`)[0] as { seq: number; watched: boolean };

test("a stranger's socket is refused with the not-a-player code before it's accepted, and wakes nothing", async () => {
  const { worldId } = await worldAgo(12);
  const { w, state } = worldDO();
  const before = await tickSeq(worldId);

  for (const userId of [await newUser(), null]) {
    const server = await open(w, worldId, userId);
    assert.deepEqual(server.closed, { code: NOT_A_PLAYER_CODE, reason: 'not a player' });
    assert.equal(server.accepted, true, 'accepted only to carry the close code');
  }
  assert.equal(state.sockets.length, 0, 'never a hibernating socket, so never watching');
  assert.equal(state.alarm(), null, 'no minute tick armed');
  assert.equal(state.data.get('watchedUntil'), undefined);
  assert.equal(await tickSeq(worldId), before, 'no catch-up ran');
});

test('while the gutter is closed, a socket is refused with 4013 before Postgres is asked', async () => {
  const { worldId, userId } = await worldAgo(12);
  const { w, state, env } = worldDO(UNREACHABLE);
  // The cron's last reading (#70): 96 CU-h this period.
  const now = new Date();
  env.WORLDS.data.set(GUTTER.kvKey, JSON.stringify({ cuHours: 96, periodEnd: nextMonthStart(now), readAt: now.toISOString() }));

  const server = await open(w, worldId, userId);
  assert.equal(GUTTER_CLOSED_CODE, 4013);
  assert.deepEqual(server.closed, { code: GUTTER_CLOSED_CODE, reason: 'gutter closed' });
  assert.equal(state.sockets.length, 0);
});

test("a Player's socket is accepted carrying its user id; the world catches up, then the socket gets ready", async () => {
  const { worldId, userId } = await worldAgo(12); // two missed 5-minute steps
  const { w, state } = worldDO();
  assert.deepEqual({ ...state.autoResponse }, { request: 'ping', response: 'pong' }, 'pings are answered without waking the DO');

  const server = await open(w, worldId, userId);
  assert.deepEqual(state.sockets, [server], 'a hibernating socket');
  assert.equal(server.accepted, false);
  assert.deepEqual(server.deserializeAttachment(), { userId });
  assert.ok(state.alarm() !== null && state.alarm()! <= nextMinuteTick(Date.now()), 'the minute tick is armed');

  await state.settled();
  assert.equal(await tickSeq(worldId), AFTER_DAY_ZERO + 2, 'caught up');
  assert.deepEqual(server.messages(), [{ type: 'ready', tick_seq: AFTER_DAY_ZERO + 2 }]);
});

test("each committed hint goes to every open socket, and on the next tick a removed Player's socket is closed", async () => {
  const { worldId, userId } = await worldAgo(3);
  const friend = await join(userId, worldId);
  const { w, state } = worldDO();
  const mine = await open(w, worldId, userId);
  const theirs = await open(w, worldId, friend);
  await state.settled();

  await db()`update players set removed_at = now() where world_id = ${worldId} and user_id = ${friend}`;
  state.clearAlarm();
  await w.alarm();

  assert.deepEqual(theirs.closed, { code: NOT_A_PLAYER_CODE, reason: 'not a player' });
  assert.equal(mine.closed, null);
  assert.equal(theirs.messages().length, 1, 'closed before the tick, so no hint for it');
  const committed = await tickSeq(worldId);
  for (const m of mine.messages().slice(1) as { type: string; tick_seq?: number }[]) {
    assert.ok(m.type === 'tick' || m.type === 'dialogue');
    if (m.type === 'tick') assert.ok(m.tick_seq! <= committed, 'a tick hint only points at a committed tick');
  }

  const before = mine.sent.length;
  (w as unknown as { keep: (h: unknown[]) => void }).keep([
    { event: 'tick', payload: { tick_seq: 7 } },
    { event: 'dialogue', payload: { fact_no: 40 } },
  ]);
  assert.deepEqual(mine.messages().slice(before), [
    { type: 'tick', tick_seq: 7 },
    { type: 'dialogue', fact_no: 40 },
  ]);
  assert.equal(theirs.messages().length, 1);
});

test('the world is watched while a socket is open and for 2 min after the last one closes, then falls back to catch-up', async () => {
  const { worldId, userId } = await worldAgo(3);
  const { w, state, env } = worldDO();
  const server: FakeSocket = await open(w, worldId, userId);
  await state.settled();

  // Only the socket keeps it watched now: the minute tick runs, watched, and the next one is armed.
  state.data.delete('watchedUntil');
  state.clearAlarm();
  await w.alarm();
  assert.ok(state.alarm() !== null, 'next minute armed');
  assert.equal((await lastTick(worldId)).watched, true);

  // The app goes hidden: the client closes its socket.
  const closedAt = Date.now();
  await w.webSocketClose(server as never, 1000, 'hidden');
  assert.deepEqual(server.closed, { code: 1000, reason: 'hidden' }, 'the close is echoed');
  assert.equal(state.getWebSockets().length, 0);
  const until = state.data.get('watchedUntil') as number;
  assert.ok(until >= closedAt + WATCH.windowMs && until <= Date.now() + WATCH.windowMs, 'watched for 2 more minutes');
  state.clearAlarm();
  await w.alarm();
  assert.ok(state.alarm() !== null, 'still ticking every minute inside the 2 min');

  // 2 min later: unwatched. The alarm stops re-arming and never touches Postgres.
  state.data.set('watchedUntil', Date.now() - 1);
  state.clearAlarm();
  env.NEON_DB_URL = UNREACHABLE;
  await w.alarm();
  assert.equal(state.alarm(), null, 'no more minute ticks');

  // From now on only the cron's catch-up wakes it, and that runs unwatched.
  env.NEON_DB_URL = DB_URL;
  const last = await lastTick(worldId);
  await w.wake(worldId);
  state.clearAlarm(); // the runtime clears an alarm as it fires
  await w.alarm();
  assert.equal(state.alarm(), null, 'a catch-up arms nothing');
  assert.deepEqual(await lastTick(worldId), last, 'inside 5 min of the last tick, the catch-up has nothing to do');
});
