# Free LLM API options

Type: research
Status: resolved
Blocked by: (none)

## Question

Mohammed wants narration to run on a **free** LLM API instead of paid Claude Haiku 5.5. Which free tiers can carry ORC NONSENSE's narration, and what do they cost us in limits, policy and privacy?

Load to carry (from [Narration tiers and tick budget](11-narration-tiers-and-tick-budget.md)):
- Clash dialogue: ~50–200 calls a day, each ~1.5k tokens in (tone bible prefix + Fact + two Captain cards + Grudge tags) and ~200 out, JSON with 2–4 lines. Bursts of ~5 calls in one minute while someone is watching.
- The Herald: a few on-open calls a day, ~3k in and ~600 out.
- Called from a Supabase Edge Function (Deno) or a Cloudflare Worker, out of band from the tick.

For each candidate (at least: Google Gemini API free tier, Groq, OpenRouter `:free` models, Cloudflare Workers AI free allocation, Mistral free tier, GitHub Models, Cerebras, Hugging Face Inference), find, from primary sources and dated:

- **Limits:** requests per minute and per day, tokens per minute and per day, and whether they fit the load above.
- **Models** on the free tier, and their likely quality at crude, British, comedic banter.
- **Content policy:** profanity, crude fictional insults between characters, accent/dialect writing. Where would it refuse or water down?
- **Data use:** does the free tier train on or retain prompts? (Prompts contain friends' free-text Rumour lines.)
- **Terms:** personal or non-commercial use allowed? Any attribution, region or account requirements?
- **Features:** structured or JSON output, prompt caching, typical latency.
- **Stability:** how often the free tier has been cut or changed, and the risk of it vanishing.

End with a ranked shortlist and a recommended primary-plus-fallback setup at $0.

## Answer

Full findings: `research/free-llm-api-options.md` on branch [`research/free-llm-api-options`](https://github.com/abdullah12353/orc-simulator/blob/research/free-llm-api-options/research/free-llm-api-options.md) (never merged).

- **Ruled out:**
  - **GitHub Models** was shut down on 2026-07-30.
  - **Cerebras** is only a $5 trial that expires after 30 days and needs a card.
  - **Hugging Face** gives free users no monthly credits.
  - **Gemini free** is paid-only for apps used by people in the UK, EEA or Switzerland. Elsewhere it trains on prompts and humans review them.
- **1. Cloudflare Workers AI:** 10k Neurons a day. When they run out, calls fail rather than bill you. It doesn't train on or keep prompts, and it runs in the Worker. Gemma 4 26B carries 200 Clashes a day on about 40% of the allowance. Llama 3.3 70B carries about 115 a day.
- **2. Groq `gpt-oss-120b`:** 30 requests/min, 1k requests/day, 8K tokens/min, 200K tokens/day, strict JSON. The token cap is the tight one: about 200 Clashes a day only because cached prefix tokens don't count against it, about 100 without that. It keeps prompts up to 30 days unless its zero-retention setting is on (available to everyone).
- **3. Mistral free:** may train on prompts unless opted out. Its usage policy has the strictest harassment wording of the lot.
- **4. OpenRouter `:free`:** 50 requests a day unless you buy $10 of credit once. The model list changes often.
- **Recommended $0 setup:** Workers AI primary (Gemma 4 26B, or Llama 3.3 70B if it writes better banter), with a daily Neuron counter that switches over near 9k. Groq `gpt-oss-120b` as fallback with zero retention on. Templates as the last resort.
- **Not verified:** latency, whether any model will actually write the banter (none were called), how Workers AI bills reasoning tokens, and whether Groq's table is the Free or Developer plan. Assumes the friends play from the UK.
- **Feeds** [Narration tiers and tick budget](11-narration-tiers-and-tick-budget.md). A model bake-off on the calibration samples is needed before locking a model.

## Comments
