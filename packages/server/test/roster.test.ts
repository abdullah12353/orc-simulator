// #32 Death, Return and the roster on the backend: day zero and every tick commit deaths, Returns,
// benchings, Humiliations (ended ones kept as history) and added Fears, held Meddles are re-fused on
// Return, and the world keeps stepping in the database exactly as it does in memory.
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content } from '@orc/content';
import { applyDiff, dayZero, simulate, STARTING, stateHash, tickSeed, type Fact, type Intent, type WorldState } from '@orc/sim';
import { tickWorld } from '@orc/server';
import { asUser, asUserCommitted, db, fakeClock, freshWorld, newUser } from './support.ts';

const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());

/** A world seed whose day zero ends with someone dead and some Humiliation already over. */
function eventfulSeed(createdAt: string): number {
  for (let seed = 1; ; seed++) {
    const { state, humiliations } = dayZero(content, seed, createdAt, 'probe');
    const dead = Object.values(state.captains).some((c) => c.roster === 'dead');
    if (dead && humiliations.some((h) => h.ended) && state.humiliations.length > 0) return seed;
  }
}

test('day zero commits its deaths, Humiliations (ended ones as history) and added Fears, readable by members only', async () => {
  const clock = fakeClock();
  const createdAt = clock.iso();
  const seed = eventfulSeed(createdAt);
  const { worldId, userId } = await freshWorld({ clock, seed });
  const { state, steps, humiliations } = dayZero(content, seed, createdAt, worldId);
  const facts = steps.flatMap((s) => s.facts);

  await asUser(userId, async (tx) => {
    const captains = await tx`
      select id, roster, epithet, alias_idx, returns_at, grace_until, death_fact::int, death_cause_tag, died_at
      from captains where world_id = ${worldId} order by id`;
    assert.equal(captains.filter((c) => c.roster === 'active').length, 12);
    for (const c of captains) {
      const m = state.captains[c.id]!;
      assert.deepEqual(
        [c.roster, c.epithet, c.alias_idx, iso(c.returns_at), iso(c.grace_until), c.death_fact, c.death_cause_tag],
        [m.roster, m.epithet, m.aliasIdx, m.returnsAt, m.graceUntil, m.death?.cause.fact ?? null, m.death?.causeTag ?? null],
        c.id,
      );
      const death = facts.find((f) => f.no === c.death_fact);
      assert.equal(iso(c.died_at), death?.at ?? null, `${c.id} died when his death Fact says`);
    }

    const rows = await tx`
      select no::int, captain_id, cat::text, kind, gained_fact::int, gained_at, expires_at, ended_at, ended_fact::int
      from humiliations where world_id = ${worldId} order by no`;
    assert.deepEqual(
      rows.map((r) => [r.no, r.captain_id, r.cat, r.kind, r.gained_fact, iso(r.expires_at), r.ended_at !== null]),
      humiliations.map((h) => [h.no, h.captainId, h.cat, h.key, h.gained.fact, h.expiresAt, h.ended]),
    );
    for (const r of rows) {
      assert.equal(iso(r.gained_at), facts.find((f) => f.no === r.gained_fact)!.at);
      if (r.ended_fact === null) continue;
      const ended = facts.find((f) => f.no === r.ended_fact)!;
      assert.ok(ended.kind === 'humiliation_ended' && ended.humiliation === r.no, `Humiliation ${r.no} ended by its Fact`);
      assert.equal(iso(r.ended_at), ended.at);
    }

    const fears = await tx<{ captain_id: string; fear: string; added: boolean }[]>`
      select captain_id, fear, added from captain_fears where world_id = ${worldId} order by captain_id, fear`;
    const expected = Object.values(state.captains)
      .flatMap((c) => c.fears.map((f) => ({ captain_id: c.id, fear: f.fear, added: f.added })))
      .sort((a, b) => (a.captain_id + a.fear < b.captain_id + b.fear ? -1 : 1));
    assert.deepEqual(fears.map((f) => ({ ...f })), expected);
  });

  const outsider = await newUser();
  const seen = await asUser(outsider, (tx) => tx`select 1 from humiliations where world_id = ${worldId}`);
  assert.equal(seen.length, 0, 'an outsider reads no Humiliations');
  await assert.rejects(asUser(userId, (tx) => tx`delete from humiliations where world_id = ${worldId}`), /permission denied/);
});

test('ticks commit deaths, Returns and benchings, hold and re-fuse a Meddle, and step exactly like the sim in memory', async () => {
  const clock = fakeClock();
  const createdAt = clock.iso();
  const seed = 5150;
  const { worldId, playerId, userId } = await freshWorld({ clock, seed });
  let { state } = dayZero(content, seed, createdAt, worldId);
  state = { ...state, players: { [playerId]: { gold: STARTING.gold, meddles: STARTING.meddles, firstMeddleDone: false, renderedFor: [] } } };

  // Feuds everywhere, so Clashes (and deaths) come thick and fast.
  const active = Object.keys(state.captains).filter((id) => state.captains[id]!.roster === 'active').sort();
  const feuds = active.map((id, i) => ({ holder: id, toward: active[(i + 1) % active.length]!, value: -95 }));
  await db()`
    insert into affinity (world_id, holder_id, toward_id, value, updated_at)
    select ${worldId}, a->>'holder', a->>'toward', (a->>'value')::smallint, ${createdAt}
    from jsonb_array_elements(${db().json(feuds)}) as a
    on conflict (world_id, holder_id, toward_id) do update set value = excluded.value`;
  state = { ...state, affinity: { ...state.affinity, ...Object.fromEntries(feuds.map((f) => [`${f.holder}>${f.toward}`, f.value])) } };

  const facts: Fact[] = [];
  let meddleId: string | null = null;
  let heldOn: string | null = null;
  for (let i = 0; i < 48; i++) {
    // Once someone is dead, plant a Rumour about him (the first Meddle: a 2–5 minute Fuse).
    let intents: Intent[] = [];
    const dead = Object.values(state.captains).find((c) => c.roster === 'dead' && c.returnsAt && Date.parse(c.returnsAt) - clock.now().getTime() > 60 * 60_000);
    if (!meddleId && dead) {
      const source = Object.keys(state.captains).filter((id) => state.captains[id]!.roster === 'active').sort()[0]!;
      const payload = { source, target: dead.id, claim: 'insult', subject: { from: 'trait', key: dead.traits[0] }, firstMeddle: true };
      meddleId = randomUUID();
      heldOn = dead.id;
      await asUserCommitted(userId, (tx) => tx`select * from submit_intent(${meddleId}, ${worldId}, 'rumour', ${tx.json(payload)})`);
      const [row] = await db()<{ created_at: string; payload: Record<string, unknown> }[]>`
        select to_json(created_at)#>>'{}' as created_at, payload from intents where id = ${meddleId}`;
      intents = [{ ...row!.payload, id: meddleId, playerId, at: new Date(row!.created_at).toISOString() } as Intent];
      const p = state.players[playerId]!;
      state = { ...state, players: { [playerId]: { ...p, meddles: p.meddles - 1 } } };
    }

    clock.advance(i % 2 === 0 ? 5 : 55);
    const tickSeq = state.world.tickSeq + 1;
    const input: WorldState = { ...state, world: { ...state.world, tickSeq, prevTickAt: state.world.now, now: clock.iso() } };
    const { facts: expected, stateDiff } = simulate(input, intents, tickSeed(seed, tickSeq));
    state = applyDiff(input, stateDiff);
    facts.push(...expected);

    const out = await tickWorld({ sql: db(), now: clock.now }, worldId);
    assert.equal(out.status, 'stepped');
    if (out.status !== 'stepped') return;
    assert.equal(out.factCount, expected.length, `tick ${tickSeq}`);
    assert.equal(out.stateHash, stateHash(state), `tick ${tickSeq}: the database state matches memory`);
  }

  const count = (kind: Fact['kind']) => facts.filter((f) => f.kind === kind).length;
  assert.ok(count('death') >= 2, `${count('death')} deaths`);
  assert.ok(count('return') >= 1, `${count('return')} Returns`);
  assert.ok(count('stepped_in') >= 2 && count('benched') >= 1, 'the roster turned over');
  const roster = await db()`select roster, count(*)::int as n from captains where world_id = ${worldId} group by roster`;
  assert.equal(roster.find((r) => r.roster === 'active')?.n, 12);

  // The Rumour about the dead Captain was held (never a Fact), and went back on a Fuse when he Returned.
  assert.ok(meddleId, 'someone died, so a Rumour was planted on him');
  const returned = facts.some((f) => f.kind === 'return' && f.intro.captainId === heldOn);
  const [m] = await db()`select status::text, held_on from meddles where id = ${meddleId}`;
  if (returned) assert.notEqual(m!.status, 'held');
  else assert.deepEqual([m!.status, m!.held_on], ['held', heldOn]);
  const held = await db()`select count(*)::int as n from facts where world_id = ${worldId} and payload::text like ${'%' + meddleId + '%'}`;
  const landed = facts.some((f) => f.kind === 'rumour' && f.meddleId === meddleId);
  assert.equal(held[0]!.n > 0, landed, 'no Fact mentions the Meddle until it lands');
});
