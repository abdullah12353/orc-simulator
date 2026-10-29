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
5. Read the real numbers off the dashboards (see below).

## What runs

There are 40 inputs per model, and each gets one call, run one after another. **No retries**: a refusal, timeout or bad output counts as a failure.
- 7 **calibration** inputs, one per tone bible §6 orc voice. Each asks for 3 new lines in that Captain's voice, rated next to his samples.
- 30 **Clash** Facts and 3 **Herald** inputs (`fixtures/`).

Groq calls are paced to stay under 30 RPM and 8K TPM. There's always a gap of at least 2.1 s. When `x-ratelimit-remaining-tokens` can't fit the next call (full prompt + `max_completion_tokens`), the runner waits out `x-ratelimit-reset-tokens`, and it honours `retry-after`. So the full Groq leg takes a few minutes.

A full run should use roughly 4,000 of the day's 10k free Neurons (about 40 × 20 on Gemma plus 40 × 80 on Llama).

## What's measured

- **Per call:** latency, prompt/completion/cached/reasoning tokens (completion always includes reasoning), estimated Neurons, and Groq's `x-ratelimit-*` headers.
- **Validation in code:** valid JSON; 3 lines, or 4 with a wrong saviour (2–4 accepted with a flag); known speakers; the loser speaks last; a cheap outcome-contradiction check; the Herald stays clean. There's also a heuristic softening detector: lecturing, `f***`, minced oaths, and missing profanity, c-word or mum joke where the Fact invites it.
- **Failure categories in `reveal`:**
  - `refusal`, and `format` (anything wrong with the output), count against the model.
  - `rate_limited` (HTTP 429) and `transport` (timeouts, network errors, other HTTP errors) are counted separately and kept out of the failure, refusal and format rates.

## The real numbers come from the dashboards

- **Neurons:** the per-call Neurons are **estimates**. Llama's rates are Cloudflare's published ones. **Gemma's rates were worked backwards from the research doc's per-Clash and per-Herald totals, so they're rough.** The real usage is in the Cloudflare dashboard (Workers AI → usage) after the run.
- **Groq's cached tokens and the daily cap:** the header check only covers the **per-minute** limit. `x-ratelimit-remaining-tokens` is TPM, and the daily cap isn't in any header. **Answer the daily-cap question by comparing the Groq console's daily token usage with the token totals in `results.json`.** If the console's figure is close to `prompt − cached + completion`, cached tokens are excluded. If it's close to `prompt + completion`, they're counted.
- **How the per-minute check works:** for each pair of consecutive successful calls, it compares the drop in remaining tokens (with the refill for the time gap added back) against two **ranges**, because Groq may reserve `max_completion_tokens` when it accepts a request:
  - excluded: `prompt − cached + completion` … `prompt − cached + max_completion_tokens`
  - counted: `prompt + completion` … `prompt + max_completion_tokens`

  Pairs where the two ranges overlap are reported as ambiguous. Pairs that span a failed call, or a refilled bucket, are skipped.

## Guesses to check on the first real run

- Workers AI `/ai/run` returns `result.response` (a string, or an object in JSON mode) and `result.usage.prompt_tokens/completion_tokens`. OpenAI-shaped `result.choices` is handled too, as is a separate top-level `reasoning_tokens` (billed as output). No cached-token field is expected.
- `max_tokens` is 512 for a Clash, 400 for calibration and 900 for the Herald (doubled on Groq to leave room for reasoning).
