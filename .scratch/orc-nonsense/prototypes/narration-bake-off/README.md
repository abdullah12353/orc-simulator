# Narration model bake-off (throwaway)

Prototype for [ticket 13](../../issues/13-narration-model-bake-off.md). Node 22, zero dependencies.

## Run it

```sh
cd .scratch/orc-nonsense/prototypes/narration-bake-off
node --test "test/*.test.mjs"     # tests
node run.mjs --mock               # dry run: fake fetch, no keys, no network
```

That writes `runs/<runId>/sheet.html` (rate this), `results.json` and `key.json` (don't open the key until you've rated). `sample-sheet.html` is a small committed mock example.

Real run:

1. **Switch Groq Zero Data Retention on first** (console → Data Controls).
2. Set keys and run. Any provider without keys is skipped.
   ```sh
   export CF_ACCOUNT_ID=... CF_API_TOKEN=...   # Workers AI: Gemma 4 26B + Llama 3.3 70B
   export GROQ_API_KEY=...                     # Groq: openai/gpt-oss-120b
   node run.mjs --limit 3   # smoke test first
   node run.mjs
   ```
   Optional: `CF_GEMMA_JSON_MODE=1` sends a json_schema `response_format` to Gemma (Workers AI only documents JSON mode for Llama 3.3). `CF_LLAMA_JSON_MODE=0` turns it off for Llama.
3. Open `sheet.html`, rate, click **Export ratings JSON**.
4. `node reveal.mjs runs/<runId> ratings-<runId>.json`

The full run is 33 inputs × 3 models, one call each and sequential, with **no retries**: a refusal, timeout or bad output counts as a failure. It costs roughly 33 × 20 Neurons on Gemma and 33 × 80 on Llama, so about a third of one day's 10k free allowance.

## What's measured

- Per call: latency, prompt/completion/cached/reasoning tokens, estimated Neurons, and Groq's `x-ratelimit-*` headers.
- Validation in code: JSON, 3 lines (4 with a wrong saviour, 2–4 accepted with a flag), known speakers, loser last, cheap outcome-contradiction check, Herald stays clean. Plus a heuristic softening detector: lecturing, `f***`, minced oaths, and missing profanity, c-word or mum joke where the Fact invites it.
- The Groq cache finding compares the drop in `x-ratelimit-remaining-tokens` between consecutive calls with the full vs uncached token count. That header is **per minute**. The daily cap isn't exposed, so check the console's usage page against `results.json` too.

## Guesses to check on the first real run

- Workers AI `/ai/run` returns `result.response` (a string, or an object in JSON mode) and `result.usage.prompt_tokens/completion_tokens`. OpenAI-shaped `result.choices` is handled too. No cached-token field is expected.
- Gemma's Neuron rates are solved back from the research doc's per-Clash totals (8,667 in / 30,000 out per 1M). Llama's match Cloudflare's published rates.
- `max_tokens` is 512 for a Clash and 900 for the Herald (doubled on Groq to leave room for reasoning).
