// #42 Pushes: the tick's commit layer queues `push_jobs` for deaths, Returns, Warlord changes and Legendary
// deeds touching a Player's Stable, and for the Player's own Meddles' heads with weight >= 15. At most 3 a
// London day, none in quiet hours (23:00–08:00 Europe/London); the dropped ones are logged. Never gold.
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLAME, dayZero, type Fact } from '@orc/sim';
import { content } from '@orc/content';
import { b64url, drainPushes, fromB64url, handleTick, pushText, queuePushes, tickWorld, type VapidKeys } from '@orc/server';
import { asUser, asUserCommitted, db, fakeClock, freshWorld, insertStoryFacts, newUser, type StoryFact } from './support.ts';

type Clock = ReturnType<typeof fakeClock>;
type World = Awaited<ReturnType<typeof freshWorld>> & { clock: Clock };

async function world(start?: string): Promise<World> {
  const clock = fakeClock(start);
  return { ...(await freshWorld({ clock })), clock };
}

async function secondPlayer(w: World, name = 'Haris') {
  const [inv] = await asUserCommitted(w.userId, (tx) => tx`select token from create_invite(${w.worldId})`);
  const userId = await newUser();
  const [row] = await asUserCommitted(userId, (tx) => tx`select join_world(${inv!.token}, ${name}) as id`);
  return { userId, playerId: row!.id as string };
}

/** Opts a Player in to pushes on one (fake) device, the way the PWA does. */
async function subscribe(w: { worldId: string }, userId: string, endpoint = `https://push.test/${randomUUID()}`) {
  await asUserCommitted(userId, (tx) => tx`select subscribe_push(${w.worldId}, ${endpoint}, 'p256dh-key', 'auth-secret')`);
  return endpoint;
}

async function back(w: { worldId: string }, playerId: string, captainId: string) {
  await db()`
    insert into stakes (world_id, player_id, captain_id, amount, created_at, updated_at)
    values (${w.worldId}, ${playerId}, ${captainId}, 5, now(), now())`;
}

async function captainIds(worldId: string): Promise<string[]> {
  return (await db()<{ id: string }[]>`select id from captains where world_id = ${worldId} order by id`).map((c) => c.id);
}

/** Appends hand-made Facts at the clock's time and returns them as the tick would hand them over. */
async function facts(w: World, list: StoryFact[]): Promise<Fact[]> {
  const nos = await insertStoryFacts(w.worldId, w.clock.iso(), list);
  const rows = await db()<{ payload: Fact }[]>`
    select payload from facts where world_id = ${w.worldId} and no = any(${nos}::bigint[]) order by no`;
  return rows.map((r) => r.payload);
}

/** Runs the commit layer's push step for these Facts, in a transaction like the tick's. */
async function queue(w: World, list: Fact[]) {
  await db().begin((tx) => queuePushes(tx, w.worldId, list, w.clock.iso()));
}

async function pushesFor(playerId: string) {
  return db()<{ fact_no: number; status: string; title: string; text: string }[]>`
    select fact_no::int, status::text, title, text from push_jobs where player_id = ${playerId} order by id`;
}

/** A Clash whose loser died: the head plus its silent death consequence. */
function clashWithDeath(loser: string): StoryFact[] {
  return [
    { minute: 0, kind: 'clash', weight: 30, line: `${loser} lost a Clash and the moat won.` },
    { minute: 0, consequenceOf: 0, kind: 'death', tier: 'silent', payload: { captainId: loser, causeTag: 'sank' } },
  ];
}

test("a death of a Captain I back pushes to me and not to a Player who doesn't back him", async () => {
  const w = await world();
  const other = await secondPlayer(w);
  const [, victim, bystander] = await captainIds(w.worldId);
  await back(w, w.playerId, victim!);
  await back(w, other.playerId, bystander!);
  await subscribe(w, w.userId);
  await subscribe(w, other.userId);

  const list = await facts(w, clashWithDeath(victim!));
  await queue(w, list);

  const mine = await pushesFor(w.playerId);
  assert.deepEqual(mine.map((p) => [p.fact_no, p.status]), [[list[0]!.no, 'queued']], 'one push, about the story');
  assert.match(mine[0]!.text, /moat won/);
  assert.equal((await pushesFor(other.playerId)).length, 0, 'not to a Player who backs someone else');
});

test('a 4th qualifying push in a London day is dropped as dropped_cap', async () => {
  const w = await world('2026-10-30T09:00:00.000Z');
  const ids = await captainIds(w.worldId);
  for (const id of ids.slice(0, 4)) await back(w, w.playerId, id);
  await subscribe(w, w.userId);

  // Four ticks, an hour apart, each killing one of my Captains.
  for (const id of ids.slice(0, 4)) {
    await queue(w, await facts(w, clashWithDeath(id)));
    w.clock.advance(60);
  }
  assert.deepEqual(
    (await pushesFor(w.playerId)).map((p) => p.status),
    ['queued', 'queued', 'queued', 'dropped_cap'],
  );
});

test('the daily count resets at the London day roll', async () => {
  const w = await world('2026-10-30T20:00:00.000Z');
  const ids = await captainIds(w.worldId);
  for (const id of ids.slice(0, 4)) await back(w, w.playerId, id);
  await subscribe(w, w.userId);
  for (const id of ids.slice(0, 3)) await queue(w, await facts(w, clashWithDeath(id)));

  w.clock.advance(13 * 60); // 09:00 the next London day
  await queue(w, await facts(w, clashWithDeath(ids[3]!)));
  assert.deepEqual(
    (await pushesFor(w.playerId)).map((p) => p.status),
    ['queued', 'queued', 'queued', 'queued'],
  );
});

test('a push at 23:30 London time is dropped as dropped_quiet', async () => {
  // 22:30 UTC in July is 23:30 in London (BST).
  const w = await world('2026-07-01T22:30:00.000Z');
  const [, victim] = await captainIds(w.worldId);
  await back(w, w.playerId, victim!);
  await subscribe(w, w.userId);

  await queue(w, await facts(w, clashWithDeath(victim!)));
  assert.deepEqual((await pushesFor(w.playerId)).map((p) => p.status), ['dropped_quiet']);
});

test('quiet hours end at 08:00 London time', async () => {
  const w = await world('2026-07-01T07:00:00.000Z'); // 08:00 BST
  const [, victim] = await captainIds(w.worldId);
  await back(w, w.playerId, victim!);
  await subscribe(w, w.userId);

  await queue(w, await facts(w, clashWithDeath(victim!)));
  assert.deepEqual((await pushesFor(w.playerId)).map((p) => p.status), ['queued']);
});

/** A head my Meddle landed as (its hop-0 Blame names me), at this comedy weight. */
function myMeddleHead(playerId: string, weight: number): StoryFact[] {
  const blame = [{ meddleId: randomUUID(), playerId, verb: 'rumour', landedFact: -1, landedAt: '', hops: 0 }];
  return [{ minute: 0, kind: 'rumour', weight, line: `A Rumour weighing ${weight} landed.`, payload: { blame } }];
}

async function meddleFacts(w: World, playerId: string, weight: number): Promise<Fact[]> {
  const list = await facts(w, myMeddleHead(playerId, weight));
  // The landing is the head itself.
  return list.map((f) => ({ ...f, blame: f.blame.map((b) => ({ ...b, landedFact: f.no, landedAt: f.at })) }));
}

test("my Meddle's story at weight 14 doesn't push; at 15 it does", async () => {
  const w = await world();
  const other = await secondPlayer(w);
  await subscribe(w, w.userId);
  await subscribe(w, other.userId);

  await queue(w, await meddleFacts(w, w.playerId, 14));
  assert.equal((await pushesFor(w.playerId)).length, 0, 'weight 14: no push');

  const fifteen = await meddleFacts(w, w.playerId, 15);
  await queue(w, fifteen);
  assert.deepEqual((await pushesFor(w.playerId)).map((p) => [p.fact_no, p.status]), [[fifteen[0]!.no, 'queued']]);
  assert.equal((await pushesFor(other.playerId)).length, 0, "not to a Player whose Meddle it isn't");
});

test('a story my Meddle set off further down the chain pushes too: my weight-8 Rumour, then the weight-25 Clash it caused', async () => {
  const w = await world();
  const other = await secondPlayer(w);
  await subscribe(w, w.userId);
  await subscribe(w, other.userId);

  const [rumour, clash, small, far] = await facts(w, [
    { minute: 0, kind: 'rumour', weight: 8, line: 'Mo whispered that Krúg cries at sunsets.' },
    { minute: 0, kind: 'clash', weight: 25, line: 'Krúg and Vrakk clashed over the sunsets.' },
    { minute: 0, kind: 'incident', weight: 14, line: 'Somebody sulked about it.' },
    { minute: 0, kind: 'incident', weight: 30, line: 'Long after, the moat overflowed.' },
  ]);
  const meddle = randomUUID();
  const second = randomUUID();
  const entry = (meddleId: string, playerId: string, hops: number) =>
    ({ meddleId, playerId, verb: 'rumour' as const, landedFact: rumour!.no, landedAt: rumour!.at, hops });
  const list: Fact[] = [
    { ...rumour!, blame: [entry(meddle, w.playerId, 0)] },
    // My Blame one hop on, twice over (two of my Meddles), and Haris's two hops on: one push each.
    { ...clash!, blame: [entry(meddle, w.playerId, 1), entry(second, w.playerId, 2), entry(randomUUID(), other.playerId, 2)] },
    { ...small!, blame: [entry(meddle, w.playerId, 2)] },
    // Past the hop cap, Blame no longer reaches me (the sim drops such entries; the push step agrees).
    { ...far!, blame: [entry(meddle, w.playerId, BLAME.hopCap + 1)] },
  ];
  await queue(w, list);

  assert.deepEqual(
    (await pushesFor(w.playerId)).map((p) => [p.fact_no, p.status]),
    [[clash!.no, 'queued']],
    'one push, for the Clash only: the Rumour weighs 8, the sulk 14, and the moat is past the cap',
  );
  assert.deepEqual((await pushesFor(other.playerId)).map((p) => p.fact_no), [clash!.no], 'Haris is blamed for the Clash too');
});

test('a Player with no device opted in gets no push rows', async () => {
  const w = await world();
  const [, victim] = await captainIds(w.worldId);
  await back(w, w.playerId, victim!);
  await queue(w, await facts(w, clashWithDeath(victim!)));
  assert.equal((await pushesFor(w.playerId)).length, 0);
});

test('push text never mentions gold', async () => {
  const w = await world();
  const [, victim] = await captainIds(w.worldId);
  await back(w, w.playerId, victim!);
  await subscribe(w, w.userId);
  const list = await facts(w, [
    { minute: 0, kind: 'incident', weight: 30, line: `${victim} sank under 30 GOLD coins.` },
    { minute: 0, consequenceOf: 0, kind: 'death', tier: 'silent', payload: { captainId: victim, causeTag: 'sank' } },
  ]);
  await queue(w, list);
  const [push] = await pushesFor(w.playerId);
  assert.ok(push, 'the death still pushes');
  assert.doesNotMatch(`${push.title} ${push.text}`, /gold/i);

  // Every title, for every reason and Captain, and the plain fallback line.
  for (const reason of ['death', 'return', 'warlord_fell', 'crowned', 'legendary', 'meddle'] as const) {
    for (const c of content.cast) {
      const t = pushText(content, reason, c.id, 'Your gold went up by 8.');
      assert.doesNotMatch(`${t.title} ${t.text}`, /gold/i, `${reason} / ${c.id}`);
    }
  }
});

/** A world seed whose day zero leaves some Captain dead. */
function seedWithADeadCaptain(createdAt: string): number {
  for (let seed = 1; ; seed++) {
    const { state } = dayZero(content, seed, createdAt, 'probe');
    if (Object.values(state.captains).some((c) => c.roster === 'dead')) return seed;
  }
}

test('the tick queues a push when a Captain I back Returns', async () => {
  const start = '2026-10-30T12:00:00.000Z';
  const clock = fakeClock(start);
  const w: World = { ...(await freshWorld({ clock, seed: seedWithADeadCaptain(start) })), clock };
  const [dead] = await db()<{ id: string }[]>`select id from captains where world_id = ${w.worldId} and roster = 'dead' order by id limit 1`;
  // Bring his Return forward to the next tick.
  await db()`update captains set returns_at = ${start} where world_id = ${w.worldId} and id = ${dead!.id}`;
  await back(w, w.playerId, dead!.id);
  await subscribe(w, w.userId);

  w.clock.advance(5);
  assert.equal((await tickWorld({ sql: db(), now: w.clock.now }, w.worldId)).status, 'stepped');

  const pushes = await pushesFor(w.playerId);
  const [ret] = await db()<{ story_no: number }[]>`
    select story_no::int from facts where world_id = ${w.worldId} and kind = 'return' and payload#>>'{intro,captainId}' = ${dead!.id}`;
  assert.ok(ret, 'he Returned');
  assert.deepEqual(pushes.map((p) => [p.fact_no, p.status]), [[ret.story_no, 'queued']]);
  assert.match(pushes[0]!.title, /is back/);
});

// ---- sending (drainPushes): a fake push service that decrypts what it gets, as a browser would ----

type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;

/** A fake device: its keys, as `pushManager.subscribe` would hand them to the PWA. */
async function device() {
  const pair = (await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])) as { publicKey: Key; privateKey: Key };
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const p256dh = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  return { endpoint: `https://push.test/${randomUUID()}`, p256dh, auth: b64url(auth), privateKey: pair.privateKey, authBytes: auth };
}
type Device = Awaited<ReturnType<typeof device>>;

async function subscribeDevice(w: { worldId: string }, userId: string, d: Device) {
  await asUserCommitted(userId, (tx) => tx`select subscribe_push(${w.worldId}, ${d.endpoint}, ${d.p256dh}, ${d.auth})`);
}

/** Decrypts an aes128gcm push body with the device's private key (RFC 8291), using WebCrypto's own HKDF. */
async function decrypt(d: Device, body: Uint8Array): Promise<unknown> {
  const salt = body.slice(0, 16);
  const idLen = body[20]!;
  const serverPublic = body.slice(21, 21 + idLen);
  const ua = fromB64url(d.p256dh);
  const shared = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: await crypto.subtle.importKey('raw', serverPublic, ECDH, false, []) },
    d.privateKey,
    256,
  );
  const derive = async (s: Uint8Array, ikm: ArrayBuffer | Uint8Array, info: Uint8Array, bits: number) =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(s), info: new Uint8Array(info) },
        await crypto.subtle.importKey('raw', new Uint8Array(ikm), 'HKDF', false, ['deriveBits']),
        bits,
      ),
    );
  const enc = (s: string) => new TextEncoder().encode(s);
  const info = new Uint8Array([...enc('WebPush: info\0'), ...ua, ...serverPublic]);
  const ikm = await derive(d.authBytes, shared, info, 256);
  const cek = await derive(salt, ikm, enc('Content-Encoding: aes128gcm\0'), 128);
  const nonce = await derive(salt, ikm, enc('Content-Encoding: nonce\0'), 96);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce },
      await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']),
      body.slice(21 + idLen),
    ),
  );
  assert.equal(plain.at(-1), 2, 'one record, last-record delimiter');
  return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
}

async function testVapid(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as { publicKey: Key; privateKey: Key };
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey: b64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))), privateKey: jwk.d!, subject: 'mailto:test@example.com' };
}

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

/** A push service answering each endpoint with a status (201 by default), recording every request. */
function pushService(statuses: Record<string, number> = {}) {
  const sent: Sent[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: init.body as Uint8Array });
    return new Response(null, { status: statuses[url] ?? 201 });
  }) as unknown as typeof globalThis.fetch;
  return { sent, fetch };
}

/** A world where my backed Captain just died, with a push queued for me on `devices`. */
async function queuedDeath(devices: Device[], start?: string) {
  const w = await world(start);
  const [, victim] = await captainIds(w.worldId);
  await back(w, w.playerId, victim!);
  for (const d of devices) await subscribeDevice(w, w.userId, d);
  const list = await facts(w, clashWithDeath(victim!));
  await queue(w, list);
  return { w, storyNo: list[0]!.no };
}

async function jobsFor(playerId: string) {
  return db()<{ status: string; detail: string | null }[]>`
    select status::text, detail from push_jobs where player_id = ${playerId} order by id`;
}

test('a queued push is sent over VAPID, encrypted for the device, and opens its story', async () => {
  const phone = await device();
  const { w, storyNo } = await queuedDeath([phone]);
  const vapid = await testVapid();
  const svc = pushService();

  const report = await drainPushes({ sql: db(), now: w.clock.now, fetch: svc.fetch, vapid }, { worldIds: [w.worldId] });

  assert.deepEqual(report, { sent: 1, failed: 0 });
  assert.equal(svc.sent.length, 1);
  const req = svc.sent[0]!;
  assert.equal(req.url, phone.endpoint);
  assert.equal(req.headers['content-encoding'], 'aes128gcm');
  assert.match(req.headers.authorization!, new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${vapid.publicKey}$`));
  assert.ok(Number(req.headers.ttl) > 0);
  const payload = (await decrypt(phone, req.body)) as { title: string; body: string; url: string };
  assert.match(payload.body, /moat won/);
  assert.equal(payload.url, `/?world=${w.worldId}&story=${storyNo}`);
  assert.doesNotMatch(JSON.stringify(payload), /gold/i);
  assert.deepEqual((await jobsFor(w.playerId)).map((j) => j.status), ['sent']);

  // Sent once: a second drain finds nothing.
  await drainPushes({ sql: db(), now: w.clock.now, fetch: svc.fetch, vapid }, { worldIds: [w.worldId] });
  assert.equal(svc.sent.length, 1);
});

test('a device the push service says is gone is forgotten; the push still counts as sent if another took it', async () => {
  const [phone, oldTablet] = [await device(), await device()];
  const { w } = await queuedDeath([phone, oldTablet]);
  const svc = pushService({ [oldTablet.endpoint]: 410 });

  await drainPushes({ sql: db(), now: w.clock.now, fetch: svc.fetch, vapid: await testVapid() }, { worldIds: [w.worldId] });

  assert.equal(svc.sent.length, 2);
  assert.deepEqual((await jobsFor(w.playerId)).map((j) => j.status), ['sent']);
  const left = await db()<{ endpoint: string }[]>`select endpoint from push_subscriptions where player_id = ${w.playerId}`;
  assert.deepEqual(left.map((s) => s.endpoint), [phone.endpoint]);
});

test('a push no device took is failed, with what the push service said', async () => {
  const phone = await device();
  const { w } = await queuedDeath([phone]);
  const svc = pushService({ [phone.endpoint]: 500 });
  const report = await drainPushes({ sql: db(), now: w.clock.now, fetch: svc.fetch, vapid: await testVapid() }, { worldIds: [w.worldId] });
  assert.deepEqual(report, { sent: 0, failed: 1 });
  const [job] = await jobsFor(w.playerId);
  assert.equal(job!.status, 'failed');
  assert.match(job!.detail!, /500/);
});

test('without VAPID keys nothing is sent and the push stays queued', async () => {
  const phone = await device();
  const { w } = await queuedDeath([phone]);
  const svc = pushService();
  const report = await drainPushes({ sql: db(), now: w.clock.now, fetch: svc.fetch, vapid: null }, { worldIds: [w.worldId] });
  assert.deepEqual(report, { sent: 0, failed: 0 });
  assert.equal(svc.sent.length, 0);
  assert.deepEqual((await jobsFor(w.playerId)).map((j) => j.status), ['queued']);
});

test('a push left queued too long goes stale instead of arriving late', async () => {
  const phone = await device();
  const { w } = await queuedDeath([phone]);
  w.clock.advance(2 * 60);
  const svc = pushService();
  await drainPushes({ sql: db(), now: w.clock.now, fetch: svc.fetch, vapid: await testVapid() }, { worldIds: [w.worldId] });
  assert.equal(svc.sent.length, 0);
  assert.deepEqual((await jobsFor(w.playerId)).map((j) => [j.status, j.detail]), [['failed', 'stale']]);
});

test("the tick endpoint sends the stepped worlds' queued pushes after it answers", async () => {
  const phone = await device();
  const { w } = await queuedDeath([phone]);
  const svc = pushService();
  const background: Promise<unknown>[] = [];
  w.clock.advance(5);
  const res = await handleTick(
    new Request('http://x/tick', { method: 'POST', headers: { authorization: 'Bearer s' }, body: JSON.stringify({ worldId: w.worldId }) }),
    { sql: db(), now: w.clock.now, secret: 's', pushes: { fetch: svc.fetch, vapid: await testVapid() }, waitUntil: (p) => background.push(p) },
  );
  assert.equal(res.status, 200);
  await Promise.all(background);
  assert.equal(svc.sent.filter((s) => s.url === phone.endpoint).length, 1);
});

test('subscriptions are owner-only, and opting in needs a Player and a well-formed subscription', async () => {
  const w = await world();
  const other = await secondPlayer(w);
  const mine = await subscribe(w, w.userId);
  await subscribe(w, other.userId);

  const seen = await asUser(w.userId, (tx) => tx<{ endpoint: string }[]>`select endpoint from push_subscriptions`);
  assert.deepEqual(seen.map((s) => s.endpoint), [mine], 'I see only my own devices');
  await assert.rejects(
    asUser(w.userId, (tx) => tx`insert into push_subscriptions (player_id, endpoint, p256dh, auth) values (${w.playerId}, 'https://x', 'k', 'a')`),
    /permission denied/,
  );

  const stranger = await newUser();
  await assert.rejects(asUser(stranger, (tx) => tx`select subscribe_push(${w.worldId}, 'https://push.test/x', 'k', 'a')`), /not_a_player/);
  await assert.rejects(asUser(w.userId, (tx) => tx`select subscribe_push(${w.worldId}, 'http://push.test/x', 'k', 'a')`), /bad_subscription/);

  // Re-subscribing the same device refreshes its keys; unsubscribing removes it.
  await asUserCommitted(w.userId, (tx) => tx`select subscribe_push(${w.worldId}, ${mine}, 'new-key', 'new-auth')`);
  const [row] = await db()<{ p256dh: string }[]>`select p256dh from push_subscriptions where player_id = ${w.playerId}`;
  assert.equal(row!.p256dh, 'new-key');
  await asUserCommitted(w.userId, (tx) => tx`select unsubscribe_push(${w.worldId}, ${mine})`);
  assert.equal((await db()`select 1 from push_subscriptions where player_id = ${w.playerId}`).length, 0);
});
