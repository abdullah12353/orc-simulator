// #37 Generated Clash dialogue: the narration outbox drained after the tick through a fake `fetch` that
// plays Workers AI and Groq. Day zero leaves a queued job per Clash, so a fresh world is a ready outbox.
// `llm_usage` is global (per provider account), so every test runs on its own UTC day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drainJobs, type NarrationDeps } from '@orc/server';
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
