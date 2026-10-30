// #38 The generated Herald: open-edition builds the templated edition, then makes at most one model call
// for the headlines, standfirsts and bodies, through a fake `fetch` that plays Workers AI and Groq.
// `llm_usage` is global (per provider account), so every test runs on its own UTC day.
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drainJobs, openEdition, tickWorld, type OpenEditionDeps } from '@orc/server';
import { asUserCommitted, db, fakeClock, freshWorld, newUser } from './support.ts';

type Clock = ReturnType<typeof fakeClock>;

/** What the model is asked for: the input JSON in the prompt's user message. */
interface HeraldInput {
  task: 'herald';
  stories: { rank: number; line: string }[];
}

interface WrittenStory {
  rank: number;
  headline: string;
  standfirst: string;
  body: string;
  [extra: string]: unknown;
}

type Behaviour = 'ok' | 'swears' | 'one_short' | ((input: HeraldInput) => WrittenStory[]);

const written = (input: HeraldInput, tag: string): WrittenStory[] =>
  input.stories.map((s) => ({
    rank: s.rank,
    headline: `${tag.toUpperCase()} HEADLINE ${s.rank}`,
    standfirst: `${tag} standfirst ${s.rank}.`,
    body: `${tag} body ${s.rank}. It was, historians agree, a Tuesday.`,
  }));

/**
 * A fake `fetch` for both providers. `delayMs` holds every answer back that long (it still honours the
 * call's abort). Records every call's provider, input and raw request body.
 */
function fakeProviders(opts: { workersAi?: Behaviour; groq?: Behaviour; delayMs?: number }) {
  const calls: { provider: 'workers-ai' | 'groq'; input: HeraldInput; body: string }[] = [];
  const usage = { prompt_tokens: 3000, completion_tokens: 600 };
  const fetch = (async (url: string | URL, init?: RequestInit) => {
    const provider = String(url).includes('api.groq.com') ? 'groq' : 'workers-ai';
    const body = String(init!.body);
    const input = JSON.parse((JSON.parse(body) as { messages: { content: string }[] }).messages.at(-1)!.content) as HeraldInput;
    calls.push({ provider, input, body });
    if (opts.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, opts.delayMs);
        init!.signal!.addEventListener('abort', () => {
          clearTimeout(t);
          reject(init!.signal!.reason);
        });
      });
    }
    const behaviour = (provider === 'groq' ? opts.groq : opts.workersAi) ?? 'ok';
    const stories =
      behaviour === 'ok'
        ? written(input, provider)
        : behaviour === 'swears'
          ? written(input, provider).map((s, i) => (i === 1 ? { ...s, body: 'The whole bloody lot of them fell in.' } : s))
          : behaviour === 'one_short'
            ? written(input, provider).slice(1)
            : behaviour(input);
    const content = JSON.stringify({ stories });
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    if (provider === 'groq') {
      return json({ choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage });
    }
    return json({ success: true, errors: [], result: { response: content, usage } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const KEYS = { workersAi: { accountId: 'test-account', apiToken: 'test-cf-token' }, groq: { apiKey: 'test-groq-key' } };

/** open-edition's deps with narration wired, collecting whatever it leaves running in the background. */
function heraldDeps(clock: Clock, fetch: typeof globalThis.fetch, extra: Partial<OpenEditionDeps> = {}) {
  const background: Promise<unknown>[] = [];
  const deps: OpenEditionDeps = {
    sql: db(),
    now: clock.now,
    narration: { fetch, providers: KEYS },
    waitUntil: (work) => void background.push(work),
    ...extra,
  };
  return { deps, background };
}

/** A fresh world on its own UTC day, with nobody's usage counted that day yet. */
async function worldOn(day: string) {
  const clock = fakeClock(`${day}T12:00:00.000Z`);
  await db()`delete from llm_usage where day = ${day}`;
  const world = await freshWorld({ clock, seed: 404 });
  return { ...world, clock };
}

const heraldJobs = (editionId: string) =>
  db()<{ status: string; provider: string | null; failure: string | null; excerpt: string | null; tokens: number | null }[]>`
    select status::text, provider, failure, excerpt, tokens from narration_jobs where kind = 'herald' and edition_id = ${editionId}`;

const storedStories = (editionId: string) =>
  db()<{ rank: number; slot: string; headline: string; standfirst: string | null; body: string | null; blame_line: string | null }[]>`
    select rank, slot, headline, standfirst, body, blame_line from edition_stories where edition_id = ${editionId} order by rank`;

const editionStatus = async (editionId: string) =>
  (await db()<{ status: string }[]>`select status from editions where id = ${editionId}`)[0]!.status;

const usage = async (day: string) =>
  Object.fromEntries(
    (await db()<{ provider: string; neurons: number; requests: number; tokens: number }[]>`
      select provider, neurons, requests, tokens from llm_usage where day = ${day}`).map((u) => [u.provider, u]),
  );

const setUsage = (day: string, provider: string, u: { neurons?: number; requests?: number; tokens?: number }) =>
  db()`
    insert into llm_usage (day, provider, neurons, requests, tokens)
    values (${day}, ${provider}, ${u.neurons ?? 0}, ${u.requests ?? 0}, ${u.tokens ?? 0})
    on conflict (day, provider) do update set neurons = excluded.neurons, requests = excluded.requests, tokens = excluded.tokens`;

test('a fast model response returns a generated edition, written by one call', async () => {
  const day = '2031-03-01';
  const world = await worldOn(day);
  const fake = fakeProviders({});
  const { deps, background } = heraldDeps(world.clock, fake.fetch);

  const out = await openEdition(deps, world);

  assert.equal(out.created, true);
  assert.equal(out.edition.status, 'generated');
  assert.equal(out.generating, false);
  assert.equal(background.length, 0, 'nothing left running');
  assert.equal(fake.calls.length, 1, 'one model call for the whole edition');
  assert.equal(fake.calls[0]!.provider, 'workers-ai');

  const full = out.edition.stories.filter((s) => s.slot !== 'gutter');
  assert.ok(full.length >= 2 && full.length <= 8, `${full.length} stories in full`);
  assert.deepEqual(fake.calls[0]!.input.stories.map((s) => s.rank), full.map((s) => s.rank), 'the lead and headlines go to the model');
  for (const s of full) {
    assert.equal(s.headline, `WORKERS-AI HEADLINE ${s.rank}`);
    assert.equal(s.standfirst, `workers-ai standfirst ${s.rank}.`);
    assert.ok(s.body?.startsWith(`workers-ai body ${s.rank}.`));
  }
  const gutter = out.edition.stories.filter((s) => s.slot === 'gutter');
  assert.ok(gutter.every((s) => !s.headline.includes('HEADLINE') && s.body === null), 'the gutter keeps its lines');

  // Stored as returned, and the job logged.
  const rows = await storedStories(out.edition.id);
  assert.deepEqual(rows.map((r) => r.headline), out.edition.stories.map((s) => s.headline));
  assert.equal(await editionStatus(out.edition.id), 'generated');
  assert.deepEqual(
    (await heraldJobs(out.edition.id)).map((j) => [j.status, j.provider, j.failure, j.tokens]),
    [['done', 'workers-ai', null, 3600]],
  );
  assert.equal((await usage(day))['workers-ai']?.requests, 1);

  // Reopening (nothing new) gives the same generated edition back, with no call.
  const again = await openEdition(deps, world);
  assert.equal(again.created, false);
  assert.equal(again.edition.status, 'generated');
  assert.deepEqual(again.edition.stories, out.edition.stories);
  assert.equal(fake.calls.length, 1);
});

test('a response slower than the wait returns the templated edition, which later becomes generated', async () => {
  const day = '2031-03-02';
  const world = await worldOn(day);
  const fake = fakeProviders({ delayMs: 300 });
  const { deps, background } = heraldDeps(world.clock, fake.fetch, { heraldWaitMs: 30 });

  const out = await openEdition(deps, world);

  assert.equal(out.created, true);
  assert.equal(out.edition.status, 'templated');
  assert.equal(out.generating, true, 'the client is told the words are still coming');
  const templated = await storedStories(out.edition.id);
  assert.deepEqual(templated.map((r) => r.headline), out.edition.stories.map((s) => s.headline));
  assert.ok(out.edition.stories.every((s) => s.body === null && s.standfirst === null));
  assert.equal(background.length, 1, 'the job finishes in the background');

  // A second open while the job runs still says so.
  const meanwhile = await openEdition(deps, world);
  assert.equal(meanwhile.created, false);
  assert.equal(meanwhile.generating, true);

  await Promise.all(background);
  assert.equal(fake.calls.length, 1);
  assert.equal(await editionStatus(out.edition.id), 'generated');
  const rows = await storedStories(out.edition.id);
  for (const r of rows) {
    if (r.slot === 'gutter') assert.equal(r.headline, templated[r.rank - 1]!.headline);
    else assert.equal(r.headline, `WORKERS-AI HEADLINE ${r.rank}`);
  }
  const later = await openEdition(deps, world);
  assert.equal(later.edition.status, 'generated');
  assert.equal(later.generating, false);
  assert.equal((await heraldJobs(out.edition.id))[0]!.status, 'done');
});

test('a swearing Herald response is rejected: the edition stays templated and the failure is logged', async () => {
  const day = '2031-03-03';
  const world = await worldOn(day);
  const fake = fakeProviders({ workersAi: 'swears' });
  const { deps } = heraldDeps(world.clock, fake.fetch);

  const out = await openEdition(deps, world);

  assert.equal(out.edition.status, 'templated');
  assert.equal(out.generating, false);
  assert.equal(fake.calls.length, 1, 'no second call, not even on Groq');
  const [job] = await heraldJobs(out.edition.id);
  assert.equal(job!.status, 'fallback');
  assert.equal(job!.provider, 'workers-ai');
  assert.equal(job!.failure, 'bad_output');
  assert.match(job!.excerpt!, /^workers-ai bad_output \(swore: bloody\)/);
  assert.equal(await editionStatus(out.edition.id), 'templated');
  assert.ok((await storedStories(out.edition.id)).every((r) => r.body === null && !r.headline.includes('HEADLINE')));
});

test('a Herald response that breaks the story count is rejected too', async () => {
  const day = '2031-03-04';
  const world = await worldOn(day);
  const fake = fakeProviders({ workersAi: 'one_short' });
  const { deps } = heraldDeps(world.clock, fake.fetch);

  const out = await openEdition(deps, world);

  assert.equal(out.edition.status, 'templated');
  const [job] = await heraldJobs(out.edition.id);
  assert.equal(job!.status, 'fallback');
  assert.equal(job!.failure, 'bad_output');
  assert.match(job!.excerpt!, /story count/);
});

test('with no provider keys the edition stays templated and no call is made', async () => {
  const day = '2031-03-05';
  const world = await worldOn(day);
  const fake = fakeProviders({});
  const { deps } = heraldDeps(world.clock, fake.fetch, { narration: { fetch: fake.fetch, providers: {} } });

  const out = await openEdition(deps, world);

  assert.equal(out.edition.status, 'templated');
  assert.equal(fake.calls.length, 0);
  assert.deepEqual(
    (await heraldJobs(out.edition.id)).map((j) => [j.status, j.failure, j.excerpt]),
    [['fallback', 'quota', 'no provider configured']],
  );
});

test('Blame lines are never sent to the model and never overwritten by it', async () => {
  const day = '2031-03-06';
  const world = await worldOn(day);
  const { clock } = world;
  await openEdition({ sql: db(), now: clock.now }, world); // edition #1 (day zero), templated

  // Zebedee joins and plants a Rumour, which lands: a story with a Blame line naming him.
  const [inv] = await asUserCommitted(world.userId, (tx) => tx`select token from create_invite(${world.worldId})`);
  const zeb = await newUser();
  await asUserCommitted(zeb, (tx) => tx`select join_world(${inv!.token}, 'Zebedee')`);
  const [a, b] = await db()<{ id: string; traits: string[] }[]>`
    select id, traits from captains where world_id = ${world.worldId} and roster = 'active' order by id limit 2`;
  const meddle = randomUUID();
  const payload = { source: a!.id, target: b!.id, claim: 'insult', subject: { from: 'trait', key: b!.traits[0] } };
  await asUserCommitted(zeb, (tx) => tx`select * from submit_intent(${meddle}, ${world.worldId}, 'rumour', ${tx.json(payload)})`);
  for (const minutes of [5, 95]) {
    clock.advance(minutes);
    assert.equal((await tickWorld({ sql: db(), now: clock.now }, world.worldId)).status, 'stepped');
  }
  const [m] = await db()`select landed_fact::int from meddles where id = ${meddle}`;
  assert.ok(m?.landed_fact, 'the Rumour landed');

  // The model tries to write Blame lines of its own; they're ignored.
  const fake = fakeProviders({
    workersAi: (input) => written(input, 'workers-ai').map((s) => ({ ...s, blameLine: 'It was the Herald all along.', blame_line: 'Nobody.' })),
  });
  const { deps } = heraldDeps(clock, fake.fetch);
  const out = await openEdition(deps, world);

  assert.equal(out.created, true);
  assert.equal(out.edition.status, 'generated');
  const story = out.edition.stories.find((s) => s.storyNo === m.landed_fact);
  assert.ok(story && story.slot !== 'gutter', 'the Rumour is printed in full');
  assert.ok(story.blameLine?.includes('Zebedee'), story.blameLine ?? 'no Blame line');
  assert.equal(story.headline, `WORKERS-AI HEADLINE ${story.rank}`);

  const sent = fake.calls[0]!;
  assert.ok(!sent.body.includes(story.blameLine!), 'no Blame line in the request');
  assert.ok(!sent.body.includes('Zebedee'), 'no Player is named in the request');
  assert.ok(!/\bMo\b/.test(JSON.stringify(sent.input)), 'not even the reader');
  assert.ok(Object.keys(sent.input.stories[0]!).every((k) => !/blame|player/i.test(k)), JSON.stringify(sent.input.stories[0]));

  const rows = await storedStories(out.edition.id);
  assert.deepEqual(rows.map((r) => r.blame_line), out.edition.stories.map((s) => s.blameLine));
  assert.ok(rows.every((r) => !r.blame_line?.includes('Herald') && r.blame_line !== 'Nobody.'));
});

test("the Herald reserve on Groq is not consumed by Clash jobs, and the Herald can spend it", async () => {
  const day = '2031-03-07';
  const world = await worldOn(day);
  await setUsage(day, 'workers-ai', { neurons: 9_000 });
  // 100 requests are left on Groq today: the Herald's reserve.
  await setUsage(day, 'groq', { requests: 900, tokens: 100_000 });
  const fake = fakeProviders({});

  // Day zero left Clash jobs; draining them makes no call and spends nothing.
  await drainJobs({ sql: db(), now: world.clock.now, fetch: fake.fetch, providers: KEYS }, { worldIds: [world.worldId] });
  assert.equal(fake.calls.length, 0, 'Clash jobs leave the reserve alone');
  assert.equal((await usage(day))['groq']!.requests, 900);

  const { deps } = heraldDeps(world.clock, fake.fetch);
  const out = await openEdition(deps, world);
  assert.equal(out.edition.status, 'generated');
  assert.deepEqual(fake.calls.map((c) => c.provider), ['groq'], 'Workers AI is out, so the Herald goes to Groq');
  assert.ok(out.edition.stories[0]!.headline.startsWith('GROQ HEADLINE'));
  const u = await usage(day);
  assert.equal(u['groq']!.requests, 901);
  assert.equal(u['groq']!.tokens, 100_000 + 3600);
  assert.equal(u['workers-ai']!.neurons, 9_000, 'no Neurons were reserved past the switch');
});
