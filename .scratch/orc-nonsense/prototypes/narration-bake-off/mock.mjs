// A fake `fetch` that impersonates the Workers AI and Groq REST APIs, so the real adapters,
// validators and sheet all run with no keys. Each mock "model" has a deterministic personality
// that exercises a different failure or softening path. Output is placeholder banter, not a quality signal.

function hash(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return (h >>> 0) / 2 ** 32;
}
const tokens = (s) => Math.ceil(s.length / 4);
const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });

const BANK = {
  hot: ['Come \'ere then, you bucket-headed cunt!', 'Your mum knows. She\'s had a look.', 'I\'ll nut you till you say sorry, you fucking melt.', 'Shut your face, you mouldy-arsed turnip.'],
  warm: ['Water? Never done shit for me.', 'That\'s not a helm, that\'s a bastard bucket.', 'Peasants, the lot of you. Smelly little peasants.', 'I\'ve ate worse than you for breakfast.'],
  soft: ['Oh, fiddlesticks, you rotter!', 'You absolute f***ing melt.', 'Let\'s keep this respectful, lads.', 'Darn it all, old chap.'],
  loser: ['Exit means exit. I\'m off. To the pub. Not the moat.', 'He started it. I just lost it.', 'Still sound, that. Proper sound.', 'I have only temporarily stopped winning.'],
};

function clashLines(input, r, style) {
  const [a, b, saviour] = input.speakerIds;
  const loser = input.fact.loser;
  const pick = (bank, k) => BANK[bank][Math.floor(hash(`${r}${k}`) * BANK[bank].length)];
  const heat = style === 'soft' && r < 0.5 ? 'soft' : r < 0.5 ? 'hot' : 'warm';
  const lines = [{ speaker: a, text: pick(heat, 1) }, { speaker: b, text: pick('warm', 2) }];
  if (saviour) lines.push({ speaker: saviour, text: 'OI! I\'m saving you! Is anyone finishing these pies?' });
  lines.push({ speaker: loser, text: pick('loser', 3) });
  return lines;
}

function heraldEdition(input) {
  const first = input.events[0].replace(/[:.].*$/, '');
  return { headline: `${first.toUpperCase()}: FORTRESS REELS`, body: `${input.events.length} events were reported. Witnesses described the scene as "about normal". The moat has declined to comment.` };
}

// Per-model personalities.
function respond(model, input) {
  const r = hash(model + JSON.stringify(input));
  if (input.task === 'herald') {
    if (model.includes('llama') && r < 0.4) return { text: 'BREAKING: ' + JSON.stringify(heraldEdition(input)) };
    return { obj: heraldEdition(input) };
  }
  if (model.includes('gemma')) {
    if (r < 0.06) return { refusal: true };
    return { obj: { lines: clashLines(input, r, 'soft') } };
  }
  if (model.includes('llama')) {
    if (r < 0.1) return { text: '```json\n' + JSON.stringify({ lines: clashLines(input, r, 'hot') }) + '\n```' };
    if (r < 0.18) return { obj: { lines: clashLines(input, r, 'hot').reverse() } };
    if (r < 0.22) return { timeout: true };
    return { obj: { lines: clashLines(input, r, 'hot') } };
  }
  // gpt-oss: strict schema, prudish.
  if (r < 0.15) return { refusal: true };
  return { obj: { lines: clashLines(input, r, 'soft') } };
}

export function createMockFetch({ latencyMs = 0 } = {}) {
  // Groq TPM bucket, cached tokens excluded (what Groq claims), so the cache finding has something to find.
  const groq = { limit: 8000, remaining: 8000, seenPrefix: false, rpd: 1000 };
  return async function mockFetch(url, init) {
    const body = JSON.parse(init.body);
    const isGroq = url.includes('api.groq.com');
    const model = isGroq ? body.model : decodeURIComponent(url.split('/ai/run/')[1]);
    const input = JSON.parse(body.messages[1].content);
    const out = respond(model, input);
    if (latencyMs) await new Promise((res) => setTimeout(res, latencyMs));
    if (out.timeout) {
      await new Promise((_, reject) => {
        if (init.signal.aborted) reject(init.signal.reason);
        init.signal.addEventListener('abort', () => reject(init.signal.reason));
      });
    }
    const prefixTokens = tokens(body.messages[0].content);
    const prompt = prefixTokens + tokens(body.messages[1].content) + 8;
    const refusalText = 'I\'m sorry, but I can\'t help write content containing offensive language or slurs.';
    const content = out.refusal ? refusalText : out.text ?? JSON.stringify(out.obj);
    const completion = tokens(content);

    if (isGroq) {
      const cached = groq.seenPrefix ? Math.floor(prefixTokens / 128) * 128 : 0;
      groq.seenPrefix = true;
      const reasoning = 60 + Math.floor(hash(content) * 80);
      groq.remaining = Math.max(0, groq.remaining - (prompt - cached + completion + reasoning));
      groq.rpd -= 1;
      const headers = {
        'x-ratelimit-limit-requests': '1000', 'x-ratelimit-remaining-requests': String(groq.rpd),
        'x-ratelimit-limit-tokens': String(groq.limit), 'x-ratelimit-remaining-tokens': String(groq.remaining),
        'x-ratelimit-reset-requests': '1m26s', 'x-ratelimit-reset-tokens': '7.66s',
      };
      // Mock calls are back to back; refill the bucket only between runs, not between calls.
      if (groq.remaining < 2500) groq.remaining = groq.limit;
      const message = out.refusal ? { role: 'assistant', content: null, refusal: refusalText } : { role: 'assistant', content };
      return json({
        choices: [{ index: 0, message, finish_reason: 'stop' }],
        usage: { prompt_tokens: prompt, completion_tokens: completion + reasoning, total_tokens: prompt + completion + reasoning,
          prompt_tokens_details: { cached_tokens: cached }, completion_tokens_details: { reasoning_tokens: reasoning } },
      }, 200, headers);
    }
    return json({ success: true, errors: [], result: { response: content, usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion } } });
  };
}
