// #37 Generated Clash dialogue: the narration outbox drained after the tick through a fake `fetch` that
// plays Workers AI and Groq. Day zero leaves a queued job per Clash, so a fresh world is a ready outbox.
// `llm_usage` is global (per provider account), so every test runs on its own UTC day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content } from '@orc/content';
import { drainJobs, handleTick, NARRATION, openEdition, tickWorld, type NarrationDeps } from '@orc/server';
import { db, fakeClock, freshWorld } from './support.ts';

type Clock = ReturnType<typeof fakeClock>;

/** What the model is asked for: the input JSON in the prompt's user message. */
interface ClashInput {
  task: 'clash';
  lines: number;
  speakers: string[];
  winner: string;
  loser: string;
}

type Behaviour =
  | 'ok'
  | 'two_lines'
  | 'wrong_speaker'
  | 'refusal'
  | 'hang'
  | ((input: ClashInput) => { speaker: string; text: string }[]);

/** Good lines in the asked-for shape: the winner jabs, the other speakers follow, the loser last. */
function goodLines(input: ClashInput, tag: string) {
  const others = input.speakers.filter((s) => s !== input.loser);
  const order = [...others, ...Array(input.lines).fill(others[0])].slice(0, input.lines - 1);
  return [...order, input.loser].map((speaker, i) => ({ speaker, text: `${tag} line ${i + 1} from ${speaker}` }));
}

const REFUSAL = "I'm sorry, but I can't help write content containing offensive language.";

/**
 * A fake `fetch` for both providers. `usage` is what each call reports back (Workers AI's Neurons come
 * from it). Records every call's provider and input.
 */
function fakeProviders(opts: {
  workersAi?: Behaviour;
  groq?: Behaviour;
  usage?: { prompt_tokens: number; completion_tokens: number };
}) {
  const calls: { provider: 'workers-ai' | 'groq'; input: ClashInput }[] = [];
  const usage = opts.usage ?? { prompt_tokens: 2500, completion_tokens: 120 };
  const fetch = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    const provider = href.includes('api.groq.com') ? 'groq' : 'workers-ai';
    const body = JSON.parse(String(init!.body)) as { messages: { role: string; content: string }[] };
    const input = JSON.parse(body.messages.at(-1)!.content) as ClashInput;
    calls.push({ provider, input });
    const behaviour = (provider === 'groq' ? opts.groq : opts.workersAi) ?? 'ok';
    if (behaviour === 'hang') {
      return new Promise<Response>((_, reject) => {
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason));
      });
    }
    let content: string;
    if (behaviour === 'refusal') content = REFUSAL;
    else {
      const lines =
        behaviour === 'ok'
          ? goodLines(input, provider)
          : behaviour === 'two_lines'
            ? goodLines(input, provider).slice(-2)
            : behaviour === 'wrong_speaker'
              ? goodLines(input, provider).map((l, i) => (i === 0 ? { ...l, speaker: 'not-in-this-clash' } : l))
              : behaviour(input);
      content = JSON.stringify({ lines });
    }
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (provider === 'groq') {
      const message = behaviour === 'refusal' ? { role: 'assistant', content: null, refusal: REFUSAL } : { role: 'assistant', content };
      return json({ choices: [{ index: 0, message, finish_reason: 'stop' }], usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens } });
    }
    return json({ success: true, errors: [], result: { response: content, usage } });
  }) as typeof globalThis.fetch;
  return { fetch, calls, of: (p: 'workers-ai' | 'groq') => calls.filter((c) => c.provider === p) };
}

const KEYS = { workersAi: { accountId: 'test-account', apiToken: 'test-cf-token' }, groq: { apiKey: 'test-groq-key' } };

const deps = (clock: Clock, fetch: typeof globalThis.fetch, extra: Partial<NarrationDeps> = {}): NarrationDeps => ({
  sql: db(),
  now: clock.now,
  fetch,
  providers: KEYS,
  ...extra,
});

/** A fresh world on its own UTC day, with day zero's Clash jobs queued and nobody's usage counted yet. */
async function worldWithJobs(day: string) {
  const clock = fakeClock(`${day}T12:00:00.000Z`);
  await db()`delete from llm_usage where day = ${day}`;
  const world = await freshWorld({ clock, seed: 404 });
  const jobs = await jobRows(world.worldId);
  assert.ok(jobs.length > 0, 'day zero left Clash jobs');
  assert.ok(jobs.every((j) => j.status === 'queued'));
  return { ...world, clock, jobs };
}

const jobRows = (worldId: string) =>
  db()<{ fact_no: number; status: string; provider: string | null; failure: string | null; excerpt: string | null; neurons: number | null; tokens: number | null }[]>`
    select fact_no::int, status::text, provider, failure, excerpt, neurons, tokens
    from narration_jobs where world_id = ${worldId} and kind = 'clash' order by fact_no`;

const dialogueRows = (worldId: string) =>
  db()<{ fact_no: number; source: string; provider: string | null; model: string | null; lines: { speaker: string; text: string }[] }[]>`
    select fact_no::int, source, provider, model, lines from clash_dialogue where world_id = ${worldId} order by fact_no`;

const usage = async (day: string) =>
  Object.fromEntries(
    (await db()<{ provider: string; neurons: number; requests: number; tokens: number }[]>`
      select provider, neurons, requests, tokens from llm_usage where day = ${day}`).map((u) => [u.provider, u]),
  );

test('under the Neuron threshold every Clash job goes to Workers AI and upgrades its dialogue', async () => {
  const day = '2031-01-01';
  const { worldId, clock, jobs } = await worldWithJobs(day);
  const fake = fakeProviders({});

  await drainJobs(deps(clock, fake.fetch), { worldIds: [worldId] });

  assert.equal(fake.of('workers-ai').length, jobs.length, 'one Workers AI call per job');
  assert.equal(fake.of('groq').length, 0);
  const after = await jobRows(worldId);
  assert.ok(after.every((j) => j.status === 'done' && j.provider === 'workers-ai' && j.failure === null));
  // 2500 prompt + 120 completion tokens on Gemma's rate table (8,667 in / 30,000 out per 1M): 25.3 → 26.
  assert.ok(after.every((j) => j.neurons === 26 && j.tokens === 2620), JSON.stringify(after[0]));
  const lines = await dialogueRows(worldId);
  assert.ok(lines.every((d) => d.source === 'generated' && d.provider === 'workers-ai' && d.lines[0]!.text.startsWith('workers-ai')));
  assert.equal(lines.length, jobs.length);

  const u = await usage(day);
  assert.equal(u['workers-ai']?.neurons, 26 * jobs.length);
  assert.equal(u['workers-ai']?.requests, jobs.length);
});

const setUsage = (day: string, provider: string, u: { neurons?: number; requests?: number; tokens?: number }) =>
  db()`
    insert into llm_usage (day, provider, neurons, requests, tokens)
    values (${day}, ${provider}, ${u.neurons ?? 0}, ${u.requests ?? 0}, ${u.tokens ?? 0})
    on conflict (day, provider) do update set neurons = excluded.neurons, requests = excluded.requests, tokens = excluded.tokens`;

test('past about 9k Neurons, Clash jobs switch to Groq', async () => {
  const day = '2031-01-02';
  const { worldId, clock, jobs } = await worldWithJobs(day);
  // Room for a couple more Gemma calls: each is reserved at its worst case (~50 Neurons) and settles to 26.
  await setUsage(day, 'workers-ai', { neurons: 9_000 - 110 });
  const fake = fakeProviders({});

  await drainJobs(deps(clock, fake.fetch), { worldIds: [worldId] });

  const after = await jobRows(worldId);
  const byProvider = (p: string) => after.filter((j) => j.provider === p).length;
  assert.ok(byProvider('workers-ai') >= 2, `${byProvider('workers-ai')} on Workers AI`);
  assert.ok(byProvider('groq') >= 1, `${byProvider('groq')} on Groq`);
  assert.equal(byProvider('workers-ai') + byProvider('groq'), jobs.length);
  assert.ok(after.every((j) => j.status === 'done'));
  // In order: once Workers AI is full, everything after it goes to Groq.
  const firstGroq = after.findIndex((j) => j.provider === 'groq');
  assert.ok(after.slice(firstGroq).every((j) => j.provider === 'groq'));
  const u = await usage(day);
  assert.ok(u['workers-ai']!.neurons <= 9_000);
  assert.equal(u['groq']?.requests, byProvider('groq'));
  assert.equal(u['groq']?.tokens, 2620 * byProvider('groq'));
});

test("Clash jobs leave Groq's Herald reserve alone, and with both providers out they keep the fallback without a call", async () => {
  const day = '2031-01-03';
  const { worldId, clock, jobs } = await worldWithJobs(day);
  await setUsage(day, 'workers-ai', { neurons: 9_000 });
  // 100 requests are left on Groq today, but those are the Herald's.
  await setUsage(day, 'groq', { requests: 900 });
  const fake = fakeProviders({});

  await drainJobs(deps(clock, fake.fetch), { worldIds: [worldId] });

  assert.equal(fake.calls.length, 0, 'no provider was called');
  const after = await jobRows(worldId);
  assert.equal(after.length, jobs.length);
  assert.ok(after.every((j) => j.status === 'fallback' && j.failure === 'quota' && j.provider === null), JSON.stringify(after[0]));
  assert.ok((await dialogueRows(worldId)).every((d) => d.source === 'fallback'));
  const u = await usage(day);
  assert.equal(u['groq']!.requests, 900, 'nothing reserved');
  assert.equal(u['workers-ai']!.neurons, 9_000);
});

test('with no provider keys set, jobs fall back as quota without a call', async () => {
  const day = '2031-01-04';
  const { worldId, clock } = await worldWithJobs(day);
  const fake = fakeProviders({});

  await drainJobs(deps(clock, fake.fetch, { providers: {} }), { worldIds: [worldId] });

  assert.equal(fake.calls.length, 0);
  assert.ok((await jobRows(worldId)).every((j) => j.status === 'fallback' && j.failure === 'quota' && j.excerpt === 'no provider configured'));
});

test("a Gemma format failure makes exactly one Groq call, whose lines are used, and Gemma's failure is logged", async () => {
  const day = '2031-01-05';
  const { worldId, clock, jobs } = await worldWithJobs(day);
  const fake = fakeProviders({ workersAi: 'two_lines' });

  await drainJobs(deps(clock, fake.fetch), { worldIds: [worldId] });

  assert.equal(fake.of('workers-ai').length, jobs.length);
  assert.equal(fake.of('groq').length, jobs.length, 'one Groq retry per job');
  const after = await jobRows(worldId);
  assert.ok(after.every((j) => j.status === 'done' && j.provider === 'groq' && j.failure === 'bad_output'), JSON.stringify(after[0]));
  assert.ok(after.every((j) => j.excerpt?.startsWith('workers-ai bad_output (needs')), String(after[0]!.excerpt));
  // Gemma's Neurons are still counted against the day.
  assert.equal((await usage(day))['workers-ai']?.neurons, 26 * jobs.length);
  assert.ok((await dialogueRows(worldId)).every((d) => d.source === 'generated' && d.provider === 'groq' && d.model === 'openai/gpt-oss-120b'));
});

test('when the Groq retry fails too, the job keeps its fallback with both failures in the excerpt', async () => {
  const day = '2031-01-06';
  const { worldId, clock, jobs } = await worldWithJobs(day);
  const fake = fakeProviders({ workersAi: 'wrong_speaker', groq: 'two_lines' });

  await drainJobs(deps(clock, fake.fetch), { worldIds: [worldId] });

  assert.equal(fake.calls.length, 2 * jobs.length, 'never a third call');
  const after = await jobRows(worldId);
  assert.ok(after.every((j) => j.status === 'fallback' && j.provider === 'groq' && j.failure === 'bad_output'));
  assert.match(after[0]!.excerpt!, /^workers-ai bad_output \(a line has a speaker who is not in the Clash\).* \| groq bad_output \(needs/);
  assert.ok((await dialogueRows(worldId)).every((d) => d.source === 'fallback'));
});

for (const [behaviour, failure] of [
  ['refusal', 'refusal'],
  ['hang', 'timeout'],
] as const) {
  test(`a ${failure} from Gemma is not retried and keeps the fallback script`, async () => {
    const day = failure === 'refusal' ? '2031-01-07' : '2031-01-08';
    const { worldId, clock, jobs } = await worldWithJobs(day);
    const fake = fakeProviders({ workersAi: behaviour });

    await drainJobs(deps(clock, fake.fetch, { timeoutMs: 30 }), { worldIds: [worldId] });

    assert.equal(fake.of('workers-ai').length, jobs.length);
    assert.equal(fake.of('groq').length, 0, 'no retry');
    const after = await jobRows(worldId);
    assert.ok(after.every((j) => j.status === 'fallback' && j.provider === 'workers-ai' && j.failure === failure), JSON.stringify(after[0]));
    assert.ok(after.every((j) => j.excerpt?.startsWith(`workers-ai ${failure}`)));
    assert.ok((await dialogueRows(worldId)).every((d) => d.source === 'fallback'));
  });
}

test("Groq's refusal (its refusal field) and Groq's bad output are final", async () => {
  for (const [day, behaviour, failure] of [
    ['2031-01-09', 'refusal', 'refusal'],
    ['2031-01-10', 'wrong_speaker', 'bad_output'],
  ] as const) {
    const { worldId, clock, jobs } = await worldWithJobs(day);
    await setUsage(day, 'workers-ai', { neurons: 9_000 });
    const fake = fakeProviders({ groq: behaviour });

    await drainJobs(deps(clock, fake.fetch), { worldIds: [worldId] });

    assert.equal(fake.of('groq').length, jobs.length, 'one call each, no retry');
    assert.ok((await jobRows(worldId)).every((j) => j.status === 'fallback' && j.provider === 'groq' && j.failure === failure));
  }
});

test('a speaker given by display name is taken as that Captain', async () => {
  const day = '2031-01-11';
  const { worldId, clock } = await worldWithJobs(day);
  const names = new Map(content.cast.map((c) => [c.id, c.name]));
  const fake = fakeProviders({ workersAi: (input) => goodLines(input, 'named').map((l) => ({ ...l, speaker: names.get(l.speaker)! })) });

  await drainJobs(deps(clock, fake.fetch), { worldIds: [worldId] });

  assert.ok((await jobRows(worldId)).every((j) => j.status === 'done' && j.failure === null));
  const dialogue = await dialogueRows(worldId);
  assert.ok(dialogue.every((d) => d.lines.every((l) => names.has(l.speaker))), 'stored with ids');
});

test('dialogue is upgraded once: a second drain makes no call and never overwrites it', async () => {
  const day = '2031-01-12';
  const { worldId, clock, jobs } = await worldWithJobs(day);
  await drainJobs(deps(clock, fakeProviders({}).fetch), { worldIds: [worldId] });
  const first = await dialogueRows(worldId);

  const again = fakeProviders({ workersAi: (input) => goodLines(input, 'second') });
  const report = await drainJobs(deps(clock, again.fetch), { worldIds: [worldId] });

  assert.deepEqual(report, { done: 0, fallback: 0 });
  assert.equal(again.calls.length, 0);
  assert.deepEqual(await dialogueRows(worldId), first);
  // Even a stray second job for the same Clash can't overwrite generated lines.
  assert.equal(jobs.length, first.length);
  await assert.rejects(
    db()`insert into narration_jobs (world_id, kind, fact_no, created_at) values (${worldId}, 'clash', ${jobs[0]!.fact_no}, now())`,
    /narration_jobs_clash_uq/,
  );
});

test('the tick endpoint commits and returns before narration finishes, which then runs in waitUntil', async () => {
  const day = '2031-01-14';
  const { worldId, clock, jobs } = await worldWithJobs(day);
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const inner = fakeProviders({});
  const gated = (async (url: string | URL, init?: RequestInit) => {
    await gate;
    return inner.fetch(url, init);
  }) as typeof globalThis.fetch;
  const background: Promise<unknown>[] = [];

  clock.advance(5);
  const res = await Promise.race([
    handleTick(
      new Request('http://x/tick', { method: 'POST', headers: { authorization: 'Bearer s' }, body: JSON.stringify({ worldId }) }),
      { sql: db(), now: clock.now, secret: 's', narration: { fetch: gated, providers: KEYS }, waitUntil: (p) => background.push(p) },
    ),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('the tick waited on narration')), 10_000)),
  ]);

  assert.equal(res.status, 200);
  const { outcomes } = (await res.json()) as { outcomes: { status: string; tickSeq: number }[] };
  assert.equal(outcomes[0]!.status, 'stepped');
  assert.equal(background.length, 1, 'the drain was handed to waitUntil');
  const [t] = await db()`select count(*)::int as n from ticks where world_id = ${worldId} and seq = ${outcomes[0]!.tickSeq}`;
  assert.equal(t!.n, 1, 'the tick is committed');
  assert.ok((await jobRows(worldId)).every((j) => j.status === 'queued'), 'narration has not finished');
  assert.ok((await dialogueRows(worldId)).every((d) => d.source === 'fallback'));

  open();
  await Promise.all(background);
  assert.equal(inner.calls.length, (await jobRows(worldId)).length);
  assert.ok(jobs.length > 0 && (await jobRows(worldId)).every((j) => j.status === 'done'));
  assert.ok((await dialogueRows(worldId)).every((d) => d.source === 'generated'));
});

test('every Clash a tick makes gets one narration job, committed with it', async () => {
  const day = '2031-01-15';
  const { worldId, clock } = await worldWithJobs(day);
  const active = (await db()<{ id: string }[]>`select id from captains where world_id = ${worldId} and roster = 'active' order by id`).map((c) => c.id);
  const feuds = active.map((id, i) => ({ holder: id, toward: active[(i + 1) % active.length]!, value: -95 }));
  await db()`
    insert into affinity (world_id, holder_id, toward_id, value, updated_at)
    select ${worldId}, a->>'holder', a->>'toward', (a->>'value')::smallint, ${clock.iso()}
    from jsonb_array_elements(${db().json(feuds)}) as a
    on conflict (world_id, holder_id, toward_id) do update set value = excluded.value`;
  const clashes = async () =>
    (await db()<{ no: number }[]>`select no::int from facts where world_id = ${worldId} and kind = 'clash' order by no`).map((f) => f.no);
  const before = (await clashes()).length;
  for (let i = 0; i < 12 && (await clashes()).length === before; i++) {
    clock.advance(5);
    assert.equal((await tickWorld({ sql: db(), now: clock.now }, worldId)).status, 'stepped');
  }
  const all = await clashes();
  assert.ok(all.length > before, 'the feuds came to blows');
  assert.deepEqual((await jobRows(worldId)).map((j) => j.fact_no), all);
});

/** The dialogue broadcasts sent on a world's channel. */
const dialogueBroadcasts = async (worldId: string) =>
  (await db()<{ payload: { fact_no: number } }[]>`
    select payload from realtime.messages where topic = ${`world:${worldId}`} and event = 'dialogue' order by inserted_at`).map(
    (m) => m.payload.fact_no,
  );

test('while the world is watched, each upgraded Clash sends a {dialogue: fact_no} broadcast; unwatched, none', async () => {
  const day = '2031-01-16';
  const watched = await worldWithJobs(day);
  const unwatched = await worldWithJobs(day);
  // Creators count as seen when they create; 5 minutes on, only a fresh sighting makes a world watched.
  watched.clock.advance(5);
  await db()`update player_private set last_seen_at = ${watched.clock.iso()} where player_id = ${watched.playerId}`;

  await drainJobs(deps(watched.clock, fakeProviders({}).fetch), { worldIds: [watched.worldId, unwatched.worldId] });

  assert.deepEqual(await dialogueBroadcasts(watched.worldId), watched.jobs.map((j) => j.fact_no));
  assert.deepEqual(await dialogueBroadcasts(unwatched.worldId), []);
});

test('a drain only takes the given worlds’ jobs', async () => {
  const day = '2031-01-13';
  const one = await worldWithJobs(day);
  const two = await worldWithJobs(day);
  await drainJobs(deps(one.clock, fakeProviders({}).fetch), { worldIds: [one.worldId] });
  assert.ok((await jobRows(one.worldId)).every((j) => j.status === 'done'));
  assert.ok((await jobRows(two.worldId)).every((j) => j.status === 'queued'));
});

// ---- a drain that dies part-way (the runtime is killed inside waitUntil) ----

const claimMinutes = NARRATION.claimTimeoutMs / 60_000;

test('a Clash job left claimed by a drain that died is logged as a fallback once its claim is stale, with no call', async () => {
  const day = '2031-01-17';
  const { worldId, clock, jobs } = await worldWithJobs(day);
  assert.ok(jobs.length >= 3);
  const [dead, dying] = jobs;
  // One drain claimed a job and was killed; a later one claimed another and was killed too.
  await db()`update narration_jobs set claimed_at = ${clock.iso()} where world_id = ${worldId} and fact_no = ${dead!.fact_no}`;
  clock.advance(claimMinutes - 1);
  await db()`update narration_jobs set claimed_at = ${clock.iso()} where world_id = ${worldId} and fact_no = ${dying!.fact_no}`;
  clock.advance(2); // the first claim is now stale; the second is not, yet

  const providers = fakeProviders({});
  const report = await drainJobs(deps(clock, providers.fetch), { worldIds: [worldId] });
  assert.equal(providers.calls.length, jobs.length - 2, 'no call for either claimed job');
  assert.deepEqual(report, { done: jobs.length - 2, fallback: 1 });
  const rows = new Map((await jobRows(worldId)).map((j) => [j.fact_no, j]));
  assert.deepEqual(
    { status: rows.get(dead!.fact_no)!.status, failure: rows.get(dead!.fact_no)!.failure },
    { status: 'fallback', failure: 'timeout' },
    'the stale claim is logged as a fallback',
  );
  assert.match(rows.get(dead!.fact_no)!.excerpt ?? '', /claim/);
  assert.equal(rows.get(dying!.fact_no)!.status, 'queued', 'a claim younger than the timeout may still be running');
  const fallback = (await dialogueRows(worldId)).find((d) => d.fact_no === dead!.fact_no)!;
  assert.equal(fallback.source, 'fallback', 'its Clash keeps the fallback script');

  clock.advance(claimMinutes);
  const later = fakeProviders({});
  assert.deepEqual(await drainJobs(deps(clock, later.fetch), { worldIds: [worldId] }), { done: 0, fallback: 1 });
  assert.equal(later.calls.length, 0);
  assert.equal((await jobRows(worldId)).find((j) => j.fact_no === dying!.fact_no)!.status, 'fallback');
  assert.ok((await jobRows(worldId)).every((j) => j.status !== 'queued'), 'nothing is stuck');
});

test('a Herald job left claimed (or never run) when its runtime died is logged as a fallback by a later drain', async () => {
  const day = '2031-01-18';
  const clock = fakeClock(`${day}T12:00:00.000Z`);
  const world = await freshWorld({ clock, seed: 404 });
  const { edition } = await openEdition({ sql: db(), now: clock.now }, world);
  const second = await freshWorld({ clock, seed: 404 });
  const { edition: other } = await openEdition({ sql: db(), now: clock.now }, second);
  // Two Herald jobs whose runtimes were killed: one after claiming, one before it ever ran.
  await db()`
    insert into narration_jobs (world_id, kind, edition_id, created_at, claimed_at)
    values (${world.worldId}, 'herald', ${edition.id}, ${clock.iso()}, ${clock.iso()}),
           (${second.worldId}, 'herald', ${other.id}, ${clock.iso()}, null)`;
  const herald = (worldId: string) =>
    db()<{ status: string; failure: string | null; excerpt: string | null }[]>`
      select status::text, failure, excerpt from narration_jobs where world_id = ${worldId} and kind = 'herald'`;

  clock.advance(claimMinutes - 1);
  await drainJobs(deps(clock, fakeProviders({}).fetch), { worldIds: [world.worldId, second.worldId] });
  assert.equal((await herald(world.worldId))[0]!.status, 'queued', 'not stale yet');

  clock.advance(2);
  const providers = fakeProviders({});
  await drainJobs(deps(clock, providers.fetch), { worldIds: [world.worldId, second.worldId] });
  for (const w of [world, second]) {
    const [job] = await herald(w.worldId);
    assert.equal(job!.status, 'fallback');
    assert.equal(job!.failure, 'timeout');
  }
  assert.ok(providers.calls.every((c) => c.input.task === 'clash'), 'the Herald jobs are never called late');
  const [e] = await db()`select status::text from editions where id = ${edition.id}`;
  assert.equal(e!.status, 'templated', 'the edition keeps its templated words');
});

// ---- the voice cards ----

test("a speaker's voice card carries his Epithet as of the Clash, from his Epithet Humiliation, not the cast card's", async () => {
  const day = '2031-01-19';
  const { worldId, clock, jobs } = await worldWithJobs(day);
  const last = jobs.at(-1)!;
  const [clash] = await db()<{ payload: { winner: string; loser: string; line: string } }[]>`
    select payload from facts where world_id = ${worldId} and no = ${last.fact_no}`;
  const winner = clash!.payload.winner;
  const card = content.cast.find((c) => c.id === winner)!;
  const [key, def] = Object.entries(content.banks.humiliations).find(
    ([, h]) => h.cat === 'epithet' && h.epithet !== card.epithet && !!h.epithet,
  )!;
  const [first] = await db()<{ no: number }[]>`select min(no)::int as no from facts where world_id = ${worldId}`;
  const firstFact = first!.no;
  // Put an Epithet Humiliation on him before this Clash (replacing whatever Epithet he had then).
  await db()`delete from humiliations where world_id = ${worldId} and captain_id = ${winner} and cat = 'epithet'`;
  const [w] = await db()`update worlds set next_no = next_no + 1 where id = ${worldId} returning next_no::int - 1 as no`;
  await db()`
    insert into humiliations (world_id, no, captain_id, cat, kind, gained_fact, gained_at)
    values (${worldId}, ${w!.no}, ${winner}, 'epithet', ${key}, ${firstFact}, ${clock.iso()})`;

  const providers = fakeProviders({});
  await drainJobs(deps(clock, providers.fetch), { worldIds: [worldId] });
  type Card = { id: string; epithet?: string };
  const call = providers.calls.find((c) => c.input.winner === winner && (c.input as unknown as { headline: string }).headline === clash!.payload.line);
  assert.ok(call, 'the Clash was narrated');
  const voice = (call.input as unknown as { captains: Card[] }).captains.find((c) => c.id === winner)!;
  assert.equal(voice.epithet, content.banks.epithets[def.epithet!]!.text);
});
