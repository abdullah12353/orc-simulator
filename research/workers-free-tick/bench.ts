// THROWAWAY (issue #50): how much CPU does one tick cost, in Node, with the shipped sim and server code?
// Never merged. Run from the repo root after `npm install`:
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning research/workers-free-tick/bench.ts
//   node --experimental-strip-types --disable-warning=ExperimentalWarning research/workers-free-tick/bench.ts --cold
//
// Warm mode: per seed, day zero (what create-world runs), then a day of 1-minute *watched* ticks with three
// meddling Players, then a few hours of 5-minute *unwatched* ticks. Each tick is timed in parts:
//   sim     simulate()                       (tick.ts times simulate+applyDiff+stateHash as cpu_ms)
//   apply   applyDiff()
//   hash    stateHash()
//   commit  the commit's JS work with no DB: building and JSON-encoding every jsonb parameter the tick
//           sends (insertFacts, commitDiff, queuePushes, insertTicks), fallbackDialogue for each Clash,
//           and queuePushes' pushText / quiet-hours / London-date work
//   load    a PROXY for loadState's JS: JSON.stringify + JSON.parse of the loaded state (no content),
//           standing in for postgres.js decoding the rows plus tick.ts mapping them. Not the real thing.
// Not measured (no DB): postgres.js wire encode/decode per statement, TLS, SCRAM auth. Estimated in the notes.
//
// Cold mode: a fresh process imports the modules, reads a mid-game state saved by the warm run, and ticks
// 5 times, timing each, plus the one-off contentVersion() hash that the first tick in an isolate pays.
//
// Timing is performance.now() around synchronous code (wall ≈ CPU for sync JS on one thread). Each tick part
// runs REPEAT times (default 3) and the fastest counts, to strip out preemption on a busy machine; run cold
// mode with REPEAT=1 or the first (cold) run is hidden. Day zero is timed once. The total is cross-checked
// against process.cpuUsage().
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const t0 = performance.now();
const { content, contentVersion, daresFor, CLAIMS, SURPRISE } = await import('@orc/content');
const tContent = performance.now();
const sim = await import('@orc/sim');
const tSim = performance.now();
const server = await import('@orc/server');
const tServer = performance.now();
const { applyDiff, dayZero, fallbackDialogue, londonDate, simulate, stateHash, tickSeed, addMinutes } = sim;
const { inQuietHours, pushText } = server;
type WorldState = import('@orc/sim').WorldState;
type Intent = import('@orc/sim').Intent;
type Fact = import('@orc/sim').Fact;
type StateDiff = import('@orc/sim').StateDiff;

const STATE_FILE = new URL('./mid-game-state.json', import.meta.url);
const PLAYERS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
];
const CREATED_AT = '2026-10-30T20:00:00.000Z';
const SEEDS = Number(process.env.SEEDS ?? 20);
const WATCHED_TICKS = Number(process.env.WATCHED_TICKS ?? 1440); // a day at 1 min
const UNWATCHED_TICKS = Number(process.env.UNWATCHED_TICKS ?? 144); // 12 h at 5 min

// ---- a deterministic stand-in for Players (copied from packages/sim/test/invariants.test.ts) ----
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}
const activeIds = (s: WorldState) => Object.keys(s.captains).filter((id) => s.captains[id]!.roster === 'active').sort();

function meddle(state: WorldState, worldSeed: number): { state: WorldState; intents: Intent[] } {
  const intents: Intent[] = [];
  const players = { ...state.players };
  for (const p of PLAYERS) {
    const roll = fnv(`${worldSeed}:${state.world.tickSeq}:${p}`);
    const id = (kind: number) => `${p.slice(0, 8)}-000${kind}-4000-8000-${String(state.world.tickSeq).padStart(12, '0')}`;
    const active = activeIds(state);
    const me = players[p]!;
    if (roll % 8 === 1 && me.meddles > 0) {
      const target = active[(roll >>> 4) % active.length]!;
      const fits = daresFor(content, state.captains[target]!);
      const dareKey = (roll >>> 12) % 5 === 0 ? SURPRISE : fits[(roll >>> 12) % fits.length]!;
      const others = active.filter((x) => x !== target);
      const victim =
        dareKey !== SURPRISE && content.banks.dares[dareKey]!.kind === 'prank' ? others[(roll >>> 20) % others.length] : undefined;
      intents.push({
        id: id(2), playerId: p, at: state.world.now, kind: 'dare', target, dareKey,
        ...(victim ? { victim } : {}), firstMeddle: !me.firstMeddleDone,
      } as Intent);
      players[p] = { ...me, meddles: me.meddles - 1 };
      continue;
    }
    if (roll % 8 === 2 && me.gold > 0) {
      const amount = 1 + ((roll >>> 4) % Math.min(me.gold, 10));
      const captainId = active[(roll >>> 12) % active.length]!;
      intents.push({ id: id(3), playerId: p, at: state.world.now, kind: 'back', captainId, amount } as Intent);
      players[p] = { ...me, gold: me.gold - amount };
      continue;
    }
    const mine = state.stakes.filter((x) => x.playerId === p);
    if (roll % 16 === 3 && mine.length > 0) {
      intents.push({ id: id(4), playerId: p, at: state.world.now, kind: 'withdraw', captainId: mine[(roll >>> 4) % mine.length]!.captainId } as Intent);
      continue;
    }
    if (roll % 4 !== 0 || me.meddles === 0) continue;
    const source = active[roll % active.length]!;
    const target = active[(roll >>> 8) % active.length]!;
    if (source === target) continue;
    const claim = CLAIMS[(roll >>> 16) % CLAIMS.length]!;
    const subject = roll & 0x100000
      ? { from: 'fear' as const, key: state.captains[target]!.fears[0]!.fear }
      : { from: 'trait' as const, key: state.captains[target]!.traits[(roll >>> 21) & 1]! };
    intents.push({
      id: id(1), playerId: p, at: state.world.now, kind: 'rumour', source, target, claim, subject, firstMeddle: !me.firstMeddleDone,
    } as Intent);
    players[p] = { ...me, meddles: me.meddles - 1 };
  }
  return { state: { ...state, players }, intents };
}

// ---- the commit's JS side, minus the DB: every jsonb parameter built and encoded as postgres.js would ----
function commitJs(state: WorldState, next: WorldState, facts: Fact[], diff: StateDiff, tickSeq: number): number {
  const enc: unknown[] = [];
  const now = state.world.now;
  // insertFacts
  if (facts.length > 0) {
    enc.push(facts.map((fact) => ({ tickSeq, fact })));
    enc.push(facts.flatMap((f) => f.causes.map((cause) => ({ fact: f.no, cause }))));
    enc.push(facts.flatMap((f) => f.blame.map((b) => ({ ...b, fact: f.no }))));
    enc.push(facts.flatMap((f) => f.infamy.map((g) => ({ fact: f.no, captainId: g.captainId, amount: g.amount }))));
    const dialogue = facts.flatMap((f) =>
      f.kind === 'clash' ? [{ fact: f.no, at: f.at, key: f.fallbackKey, lines: fallbackDialogue(content, f) }] : [],
    );
    enc.push(dialogue, dialogue);
  }
  // commitDiff (each section is one jsonb parameter)
  enc.push(diff.world, diff.captains, diff.fears, diff.humiliations.upsert, diff.affinity, diff.grudgeTags, diff.intents,
    diff.newMeddles, diff.meddles, diff.fuses.add, diff.trophies.upsert, diff.playerDeltas, diff.stakes, diff.ledger, diff.ledger);
  // queuePushes: the JS that picks and words pushes (every Player assumed to have a device)
  const today = londonDate(now);
  const quiet = inQuietHours(now);
  const jobs = [];
  for (const f of facts) {
    if (f.kind === 'death' || f.kind === 'warlord_fell' || f.kind === 'legendary' || f.kind === 'return' || f.kind === 'crowned' ||
      (f.no === f.storyNo && (f.comedyWeight ?? 0) >= 15 && f.blame.length > 0)) {
      for (const p of PLAYERS) {
        jobs.push({ playerId: p, factNo: f.storyNo, status: quiet ? 'dropped_quiet' : 'queued', today, ...pushText(content, 'meddle', null, f.line) });
      }
    }
  }
  if (jobs.length > 0) enc.push(jobs, PLAYERS.map((id) => ({ id, count: 1 })));
  // insertTicks
  enc.push([{ seq: tickSeq, at: now, seed: tickSeed(1, tickSeq), watched: state.world.watched, contentVersion: next.world.contentVersion,
    intentIds: diff.intents.map((i) => i.id), factCount: facts.length, cpuMs: 1, stateHash: 'x' }]);
  let bytes = 0;
  for (const v of enc) bytes += JSON.stringify(v).length;
  return bytes;
}

/** Proxy for loadState: the loaded state's data round-tripped through JSON (rows decoded, then mapped). */
function loadProxy(state: WorldState): WorldState {
  const { content: c, ...data } = state;
  return { ...(JSON.parse(JSON.stringify(data)) as Omit<WorldState, 'content'>), content: c };
}

interface Sample { sim: number; apply: number; hash: number; commit: number; load: number; facts: number; intents: number }

// Each part runs REPEAT times on the same input (all pure) and keeps the fastest run: on a busy machine that
// strips out time the OS gave to other processes, so it approximates CPU rather than wall time.
const REPEAT = Number(process.env.REPEAT ?? 3);
function best<T>(fn: () => T): { value: T; ms: number } {
  let ms = Infinity;
  let value!: T;
  for (let i = 0; i < REPEAT; i++) {
    const a = performance.now();
    value = fn();
    ms = Math.min(ms, performance.now() - a);
  }
  return { value, ms };
}

function tick(state: WorldState, worldSeed: number, minutes: number, watched: boolean, intents: Intent[]) {
  const tickSeq = state.world.tickSeq + 1;
  const load = best(() => loadProxy(state));
  const loaded = load.value;
  const input: WorldState = {
    ...loaded,
    world: { ...loaded.world, tickSeq, prevTickAt: loaded.world.now, now: addMinutes(loaded.world.now, minutes), watched },
  };
  const run = best(() => simulate(input, intents, tickSeed(worldSeed, tickSeq)));
  const { facts, stateDiff } = run.value;
  const apply = best(() => applyDiff(input, stateDiff));
  const next = apply.value;
  const hash = best(() => stateHash(next));
  const commit = best(() => commitJs(input, next, facts, stateDiff, tickSeq));
  const sample: Sample = {
    load: load.ms, sim: run.ms, apply: apply.ms, hash: hash.ms, commit: commit.ms, facts: facts.length, intents: intents.length,
  };
  return { state: next, sample };
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};
const fmt = (n: number) => n.toFixed(3).padStart(8);
function report(label: string, samples: Sample[]) {
  const cols: [string, (s: Sample) => number][] = [
    ['simulate', (s) => s.sim],
    ['applyDiff', (s) => s.apply],
    ['stateHash', (s) => s.hash],
    ['sim+apply+hash (=cpu_ms)', (s) => s.sim + s.apply + s.hash],
    ['commit JS (no DB)', (s) => s.commit],
    ['load proxy', (s) => s.load],
    ['TOTAL measured JS', (s) => s.sim + s.apply + s.hash + s.commit + s.load],
  ];
  console.log(`\n${label}: ${samples.length} ticks, mean facts/tick ${(samples.reduce((n, s) => n + s.facts, 0) / samples.length).toFixed(2)}, ` +
    `ticks with intents ${samples.filter((s) => s.intents > 0).length}, max facts ${Math.max(...samples.map((s) => s.facts))}`);
  console.log(`${'ms'.padEnd(26)}     p50      p95      p99      max     mean`);
  for (const [name, get] of cols) {
    const xs = samples.map(get);
    console.log(`${name.padEnd(26)}${fmt(pct(xs, 50))} ${fmt(pct(xs, 95))} ${fmt(pct(xs, 99))} ${fmt(Math.max(...xs))} ${fmt(xs.reduce((a, b) => a + b, 0) / xs.length)}`);
  }
}

if (process.argv.includes('--cold')) {
  // A fresh isolate's first ticks: module load, then the one-off content hash, then 5 ticks.
  const saved = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Omit<WorldState, 'content'> & { worldSeed: number };
  const { worldSeed, ...data } = saved;
  const q0 = performance.now();
  inQuietHours(data.world.now); // the first Intl.DateTimeFormat with a time zone loads ICU zone data
  const q1 = performance.now();
  inQuietHours(data.world.now);
  const q2 = performance.now();
  // SCRAM-SHA-256 as postgres.js's Workers build does it (Web Crypto PBKDF2, 4096 iterations, Neon's default)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('a-neon-password-24-chars'), 'PBKDF2', false, ['deriveBits']);
  const s0 = performance.now();
  await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(16), iterations: 4096 }, key, 256);
  const s1 = performance.now();
  console.log(`  first inQuietHours() ${(q1 - q0).toFixed(2)} ms, second ${(q2 - q1).toFixed(3)} ms; SCRAM PBKDF2 x4096 ${(s1 - s0).toFixed(2)} ms`);
  const a = performance.now();
  const version = contentVersion(content);
  const b = performance.now();
  let state: WorldState = { ...data, content, world: { ...data.world, contentVersion: version } };
  const firsts: number[] = [];
  for (let i = 0; i < 5; i++) {
    const m = meddle(state, worldSeed);
    const r = tick(m.state, worldSeed, 1, true, m.intents);
    const s = r.sample;
    firsts.push(+(s.sim + s.apply + s.hash + s.commit + s.load).toFixed(2));
    if (i === 0) console.log(`  first tick parts ms: sim ${s.sim.toFixed(2)} apply ${s.apply.toFixed(2)} hash ${s.hash.toFixed(2)} commit ${s.commit.toFixed(2)} load ${s.load.toFixed(2)} (facts ${s.facts})`);
    state = r.state;
  }
  console.log(`cold: import content ${(tContent - t0).toFixed(1)} ms, sim ${(tSim - tContent).toFixed(1)}, server+postgres ${(tServer - tSim).toFixed(1)}; ` +
    `contentVersion() ${(b - a).toFixed(2)} ms; ticks 1-5 total JS ms: ${firsts.join(', ')}`);
  process.exit(0);
}

console.log(`node ${process.version}; REPEAT ${REPEAT} (fastest of); seeds ${SEEDS}; per seed: day zero, ${WATCHED_TICKS} watched 1-min ticks, ${UNWATCHED_TICKS} unwatched 5-min ticks`);
const cpu0 = process.cpuUsage();
const watched: Sample[] = [];
const unwatched: Sample[] = [];
const firstTicks: number[] = [];
const dayZeroMs: number[] = [];
const dayZeroCommitMs: number[] = [];
let wallSum = 0;
for (let seed = 1; seed <= SEEDS; seed++) {
  const worldSeed = seed * 7919;
  const a = performance.now();
  const dz = dayZero(content, worldSeed, CREATED_AT, `world-${seed}`, PLAYERS);
  const b = performance.now();
  // create-world's commit JS: every day-zero Fact (+ Clash scripts), the world state and 288 ticks rows, encoded.
  const facts = dz.steps.flatMap((s) => s.facts.map((fact) => ({ tickSeq: s.tickSeq, fact })));
  let bytes = JSON.stringify(facts).length;
  for (const { fact } of facts) if (fact.kind === 'clash') bytes += JSON.stringify(fallbackDialogue(content, fact)).length;
  const { content: _c, ...stateData } = dz.state;
  bytes += JSON.stringify(stateData).length + JSON.stringify(dz.grudgeTags).length + JSON.stringify(dz.humiliations).length;
  bytes += JSON.stringify(dz.steps.map((s) => ({ seq: s.tickSeq, at: s.at, seed: s.seed, stateHash: s.stateHash }))).length;
  const c = performance.now();
  dayZeroMs.push(b - a);
  dayZeroCommitMs.push(c - b);
  wallSum += c - a;

  let state = dz.state;
  for (let i = 0; i < WATCHED_TICKS; i++) {
    const m = meddle(state, worldSeed);
    const r = tick(m.state, worldSeed, 1, true, m.intents);
    state = r.state;
    const s = r.sample;
    const total = s.sim + s.apply + s.hash + s.commit + s.load;
    wallSum += total;
    if (i === 0) firstTicks.push(total);
    watched.push(s);
    if (seed === 1 && i === WATCHED_TICKS - 1) {
      const { content: _x, ...data } = state;
      writeFileSync(STATE_FILE, JSON.stringify({ ...data, worldSeed }));
    }
  }
  for (let i = 0; i < UNWATCHED_TICKS; i++) {
    const r = tick(state, worldSeed, 5, false, []);
    state = r.state;
    const s = r.sample;
    wallSum += s.sim + s.apply + s.hash + s.commit + s.load;
    unwatched.push(s);
  }
  if (seed === 1) {
    const { content: _x, ...data } = state;
    console.log(`end-of-run world size (seed 1): ${(JSON.stringify(data).length / 1024).toFixed(0)} KiB JSON, ` +
      `${data.grudgeTags.length} grudge tags, ${Object.keys(data.affinity).length} affinity pairs, ${data.fuses.length} fuses, ` +
      `${data.infamy7d.length} infamy rows, ${Object.keys(data.meddles).length} meddles, ${data.humiliations.length} humiliations`);
  }
}
const cpu = process.cpuUsage(cpu0);

report('WATCHED 1-minute ticks (all seeds)', watched);
// Steady state only: drop each seed's first 50 ticks (JIT warm-up inside the process).
report('WATCHED, excluding the first 50 ticks of each seed', watched.filter((_, i) => i % WATCHED_TICKS >= 50));
if (WATCHED_TICKS > 1440) report('WATCHED, last 1440 ticks (last day) of each seed', watched.filter((_, i) => i % WATCHED_TICKS >= WATCHED_TICKS - 1440));
report('UNWATCHED 5-minute ticks', unwatched);
const st = (xs: number[]) => `p50 ${pct(xs, 50).toFixed(1)}  p95 ${pct(xs, 95).toFixed(1)}  max ${Math.max(...xs).toFixed(1)}  min ${Math.min(...xs).toFixed(1)}`;
console.log(`\ncreate-world day zero (288 steps, simulate+applyDiff+stateHash) ms: ${st(dayZeroMs)}  (seed 1, coldest: ${dayZeroMs[0]!.toFixed(1)})`);
console.log(`create-world commit JS (encode all Facts, Clash scripts, state, ticks) ms: ${st(dayZeroCommitMs)}`);
console.log(`first watched tick after day zero, per seed, ms: ${firstTicks.map((x) => x.toFixed(2)).join(' ')}`);
console.log(`\ncross-check: timed sections ${(wallSum / 1000).toFixed(2)} s; process.cpuUsage user+system over the loop ${((cpu.user + cpu.system) / 1e6).toFixed(2)} s ` +
  `(includes the Player stand-in and GC threads)`);
