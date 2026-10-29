# Free LLM API options for narration

Ticket: "Free LLM API options" (`.scratch/orc-nonsense/issues/12-free-llm-api-options.md`)
Researched: 2026-10-29. Every source below was accessed on **2026-10-29**.
Sources are official docs, pricing pages, policy pages and first-party APIs. Anything the sources don't settle is marked **UNCERTAIN**. Anything that is my reading, not the source's words, is marked **INFERENCE**.

The load we need to carry (from ticket 11):

| Call | Volume | Tokens in / out | Shape |
|---|---|---|---|
| Clash dialogue | ~50–200/day, bursts of ~5 in one minute | ~1.5k / ~200 | JSON, 2–4 lines |
| Herald | a few/day, on open | ~3k / ~600 | JSON |

Daily total at the top of the range: about **200 calls, ~310k input tokens and ~42k output tokens** before any reasoning tokens.

**TL;DR**

- **Gone or not free:** GitHub Models was **retired on 2026-07-30**. Cerebras is only a **$5, 30-day trial**. Hugging Face gives free users **no monthly credits**. None of the three can carry a $0 setup.
- **Gemini free tier is ruled out for us.** Google's terms say "You may use only Paid Services when making API Clients available to users in the European Economic Area, Switzerland, or the United Kingdom." Outside those regions, unpaid prompts are used for training and **read by human reviewers**. Google no longer publishes free-tier numbers.
- **Cloudflare Workers AI is the best primary.** 10,000 Neurons a day for free, a hard stop rather than a bill, it **does not train on or retain** prompts, and it runs inside the Worker. With a cheap model (Gemma 4 26B A4B) the full load costs about **40% of the daily allowance**. Llama 3.3 70B covers only about **100 Clashes a day**.
- **Groq is the best fallback.** 30 RPM, 1K RPD, 8K TPM and 200K TPD on `gpt-oss-120b`, strict JSON schema, **Zero Data Retention open to "all customers"**, and cached prompt tokens don't count against the limits. The 200K-token daily cap is the tight one.
- **Mistral free mode** is a usable third option. No card is needed. It **may train on your data by default**, but you can switch that off. Its exact limits appear only in the console, and its usage policy has the strictest wording on "harassing language towards any target".
- **OpenRouter `:free`** allows only **50 requests/day** unless you have bought $10 of credits. The free model list churns, and the free endpoints run on trial or research tiers. Its Gemma 4 free endpoint is served by Google AI Studio's free tier.
- **Recommended $0 setup:** Cloudflare Workers AI as primary, Groq `openai/gpt-oss-120b` (ZDR on) as fallback, and the existing templated lines as the last resort. A one-evening bake-off on the calibration samples should pick the Workers AI model.

---

## 1. Candidate-by-candidate

### 1.1 Google Gemini API (free tier)

| Fact | Source |
|---|---|
| Free-tier models: Gemini 3.8 Flash, 3.6 Flash, 3 Flash Preview, 3.5 Flash-Lite, 3.1 Flash-Lite, 2.5 Pro, 2.5 Flash, 2.5 Flash-Lite, Gemma 4 and others. **3.1 Pro Preview and Gemini 4 Argon have no free tier.** | [Pricing](https://ai.google.dev/gemini-api/docs/pricing) (last updated 2026-10-28) |
| Every free-tier model shows "Used to improve our products: **Yes**" on Free and "No" on Paid. | same |
| Free context caching is listed for 3.8 Flash, 3.6 Flash, 3 Flash Preview and Gemma 4. It is "Not available" for the Flash-Lite and 2.5 models. | same |
| The rate-limits page gives **no free-tier numbers**. Free shows "N/A", and you are told to "View your active rate limits in AI Studio". Limits apply per project. RPD resets at midnight Pacific. | [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) (last updated 2026-10-28) |
| A user on Google's developer forum reports **20 RPD** for Gemini 3.8 Flash on the free tier. **UNCERTAIN:** this is a user report, not an official figure. At 20 RPD it wouldn't carry the load. | [Forum thread](https://discuss.ai.google.dev/t/gemini-3-8-flash-free-tier-20-rpd-is-too-limited-for-practical-evaluation/180609) |
| "**You may use only Paid Services when making API Clients available to users in the European Economic Area, Switzerland, or the United Kingdom.**" | [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms) (last updated 2026-04-28) |
| Unpaid Services: "Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products … **human reviewers may read, annotate, and process your API input and output** … Do not submit sensitive, confidential, or personal information to the Unpaid Services." | same |
| In the EEA, Switzerland and the UK, the paid data terms apply to unpaid quota too. That doesn't lift the use restriction above. | same |
| "You must be 18 years of age or older" and API Clients must not be "likely to be accessed by individuals under the age of 18". Use is "for professional or business purposes, not for consumer use". | same |
| Safety filters (harassment, hate speech, sexually explicit, dangerous, jailbreak) default to **Off for Gemini 2.5 and later**. Core protections such as child safety can't be changed. | [Safety settings](https://ai.google.dev/gemini-api/docs/safety-settings) |

**Verdict (INFERENCE):** the friends are British, so the free tier breaks the terms. If anyone plays from outside the UK/EEA, their friends' Rumour lines would also be open to training and human review. **Don't use it.** The models themselves would probably be the best free writers of banter, and the filters are off by default. That makes Gemini *paid* worth remembering as an alternative to Haiku, but that's outside this ticket.

### 1.2 Groq (free plan)

| Fact | Source |
|---|---|
| Free-plan table (the "Free Plan Limits" tab, which is the default one served): **`openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`: 30 RPM, 1K RPD, 8K TPM, 200K TPD.** `gpt-oss-safeguard-20b`: 3 RPM. | [Rate limits](https://console.groq.com/docs/rate-limits) (no date on the page) |
| **UNCERTAIN:** the same page says "the limits shown below are the base limits for the Developer plan", which is ambiguous. Check the account's limits page after signing up. | same |
| Production models: `llama-3.1-8b-instant` and `llama-3.3-70b-versatile` are now marked **Enterprise**. `gpt-oss-120b`/`20b` are production. `qwen/qwen3.8-27b` is a preview model ("may be discontinued at short notice"). | [Models](https://console.groq.com/docs/models) |
| Strict `json_schema` works on `gpt-oss-20b`, `gpt-oss-120b`, `qwen3.8-27b` and `muse-spark-open`. JSON Object Mode works on all models. | [Structured outputs](https://console.groq.com/docs/structured-outputs) |
| Prompt caching on the gpt-oss models: 50% off cached input, and "**Cached tokens do not count towards your rate limits**". The minimum prefix is 128–1024 tokens depending on the model. The cache expires after 2 h of no use. | [Prompt caching](https://console.groq.com/docs/prompt-caching) |
| "By default, Groq does not retain customer data for inference requests". Inputs and outputs may be logged for up to 30 days for reliability or abuse checks. "**All customers may enable Zero Data Retention (ZDR)** in Data Controls settings." Training isn't mentioned. | [Your data](https://console.groq.com/docs/your-data) |
| The AUP bans "hate speech, harassment", using the service "to harass, harm, or encourage the harm of individuals or specific groups", and "sexually explicit content that is illegal". It says nothing on profanity and has no fiction carve-out. | [Acceptable Use & Responsible AI Policy](https://console.groq.com/docs/legal/ai-policy) (effective 2025-10-15) |

**Fit (INFERENCE):** 200 Clashes at ~1.7k tokens is ~340k tokens a day, which is **over the 200K TPD cap**. That changes if the ≥1k-token tone-bible prefix gets cache hits, because cached tokens don't count. Then each call counts as about 0.5k uncached input, 200 output and the reasoning tokens. Reasoning effort `low` brings that to roughly 0.8–1k per call, so 200 calls fit. A burst of 5 uncached calls (~8.5k tokens) is just over **8K TPM**. With caching it fits. Without cache hits, Groq alone carries about 100–115 Clashes a day. Groq is known for very fast output. **UNCERTAIN:** I found no published latency figure.

### 1.3 OpenRouter `:free` models

| Fact | Source |
|---|---|
| `:free` limits: **20 RPM. 50 requests/day if you have bought fewer than 10 credits in total, 1,000/day if you have bought at least 10.** The limits are global, so more keys or accounts don't help. | [Limits](https://openrouter.ai/docs/api/reference/limits) |
| Live `:free` list today (16 text models), including `google/gemma-4-31b-it:free`, `google/gemma-4-26b-a4b-it:free`, `nvidia/nemotron-3-ultra-550b-a55b:free`, `thinkingmachines/inkling:free` and `recursive/flint-v1.0:free`. Two expire on **2026-10-31** (`poolside/laguna-*`) and one on 2026-12-31 (`dots-studio/dots-3-note-preview`). | [Models API](https://openrouter.ai/api/v1/models), queried 2026-10-29 |
| The Gemma 4 `:free` endpoints are served by **Google AI Studio**, and they support `response_format`. The Nemotron and Inkling free endpoints list no `response_format`. | [Endpoints API](https://openrouter.ai/api/v1/models/google/gemma-4-31b-it:free/endpoints) |
| Free providers' own terms: Thinking Machines links a "**Free Research API tier**" ToS and privacy notice. NVIDIA links its "**API Trial** Terms of Service". **UNCERTAIN:** both are PDFs I couldn't extract, so their training and retention clauses are unverified. | [Providers API](https://openrouter.ai/api/v1/providers) |
| OpenRouter's own prompt logging and product-improvement use are both "Off by default". There are "separate settings for paid and free models" covering providers that may train. "Wherever possible, OpenRouter works with providers to ensure that prompts will not be trained on, but there are exceptions." | [Data collection](https://openrouter.ai/docs/guides/privacy/data-collection), [Logging](https://openrouter.ai/docs/guides/privacy/logging) |

**Fit (INFERENCE):** 50 RPD doesn't carry 50–200 Clashes. A one-off $10 credit purchase lifts the cap to 1,000/day, so the setup is no longer strictly $0. Gemma `:free` routes to Google's free tier, which brings Google's free-tier data terms back in by the side door (§1.1). The other free endpoints run on trial or research terms. The free list is visibly churning. **Fallback at most, and not with friends' text.**

### 1.4 Cloudflare Workers AI (free allocation)

| Fact | Source |
|---|---|
| **10,000 Neurons/day free**, resetting at 00:00 UTC. Beyond that it costs $0.011 per 1,000 Neurons, but only on Workers Paid. On Workers Free, "further operations will fail with an error". **You can't be billed.** | [Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) (last updated 2026-10-20) |
| "Some models require a paid billing method", for example `kimi-k2.6` and `deepseek-v4-pro`. The models costed below are not on that list. | same |
| Text generation is limited to 300 requests/minute by default. | [Limits](https://developers.cloudflare.com/workers-ai/platform/limits/) |
| "**Cloudflare does not use Customer Content processed by Workers AI to train AI models.**" "Cloudflare does not retain inputs or outputs after they are no longer needed" to handle the request. Content is stored only if you turn on AI Gateway logging or caching. | [Data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/) |
| The terms say you must follow the model provider's own terms and acceptable-use policy where they apply. Content Cloudflare finds "illegal, harmful, or in violation of the Agreement may be blocked or removed." | [Service-specific terms](https://www.cloudflare.com/service-specific-terms-developer-platform/) (updated 2026-09-28) |
| JSON Mode is listed for `llama-3.3-70b-instruct-fp8-fast` and a few older models. Output isn't guaranteed, so you must handle the "JSON Mode couldn't be met" error. It doesn't work with streaming. | [JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/) |
| `gpt-oss-120b` has a 128k context, reasoning low/medium/high and a `response_format` parameter (its contents aren't documented). There's an OpenAI-compatible `/v1/chat/completions`. | [gpt-oss-120b model page](https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/) |

Neuron cost of our load (rates from the pricing page; the arithmetic is mine):

| Model | Neurons per Clash (1.5k/200) | Neurons per Herald (3k/600) | Clashes/day in 10k (with 3 Heralds) |
|---|---|---|---|
| `@cf/google/gemma-4-26b-a4b-it` | ~19 | ~44 | **~500** |
| `@cf/qwen/qwen3-30b-a3b-fp8` | ~13 | ~32 | ~760 |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | ~52 | ~120 | ~185 |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | ~58 | ~126 | ~165 |
| `@cf/openai/gpt-oss-120b` | ~61 + reasoning (~14 per 200 reasoning tokens) | ~136 + reasoning | ~120–160 |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | ~81 | ~203 | **~115** |

**UNCERTAIN:** the pricing page doesn't say how reasoning tokens are billed. INFERENCE: they're billed as output.

**Fit (INFERENCE):** Gemma 4 26B A4B carries the full 200-Clash day at ~40% of the allowance. Llama 3.3 70B carries a 100-Clash day. Running out is safe, because calls error and the templated lines take over. It's native to a Cloudflare Worker through the `AI` binding, so there's no second secret to manage. Latency isn't published (**UNCERTAIN**).

### 1.5 Mistral (free mode)

| Fact | Source |
|---|---|
| "**Free mode**: API access is enabled by default with no credit card required. Usage and rate limits apply." | [Activate Studio and generate an API key](https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key.md) |
| "Free mode (the default) has the lowest limits, intended for evaluation and prototyping." The limits (tokens/minute and requests/second per model) are shown **only on the Admin panel Limits page**. | [Help: rate limits](https://help.mistral.ai/en/articles/698531-why-am-i-hitting-api-rate-limits-and-how-do-i-increase-them) (2026-08-12), [Usage and limits](https://docs.mistral.ai/admin/billing-usage/usage-limits.md) |
| Free mode: "**we may use your data (input and output) to train our artificial intelligence models**". You can opt out at any time. API opt-out: Admin panel → Privacy → disable "Anonymous improvement data". | [Help: training](https://help.mistral.ai/en/articles/347617-do-you-use-my-user-data-to-train-your-artificial-intelligence-models), [Help: opt-out](https://help.mistral.ai/en/articles/455207-can-i-opt-out-of-my-input-or-output-data-being-used-for-training) (2026-09-03) |
| Current models: Mistral Small 4, Medium 3.5, Large 4 (v26.10). | [Models](https://docs.mistral.ai/getting-started/models/) |
| The usage policy bars content that promotes hate on protected traits, "**Harassing language towards any target**", and content that celebrates "The suffering or humiliation of others". It has no profanity clause and no fiction carve-out. | [Usage policy](https://legal.mistral.ai/terms/usage-policy) (effective 2026-06-11) |
| Phone verification: **UNCERTAIN.** Third-party guides say one verified phone number per plan. I didn't confirm this on a Mistral page. | — |

**Fit (INFERENCE):** the published wording reads stricter than Groq's or Cloudflare's. Read literally, "harassing language towards any target" covers orcs insulting orcs. In practice Mistral's models are known as among the least prudish, so the refusal risk is low, but the policy risk is on paper. The exact limits are unknown until you sign up. It's a reasonable third fallback once the training opt-out is switched off.

### 1.6 GitHub Models

"**As of July 30, 2026, GitHub Models has been fully retired.**" The playground, catalog, inference API and BYOK are gone. ([GitHub Docs](https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models)) **Out.**

### 1.7 Cerebras

The free option is a trial: "New accounts receive **$5 in free credits** after adding a verified payment method … These credits expire 30 days after they're granted." "Cerebras doesn't currently offer a no-cost tier that renews automatically." Trial limits are 5 RPM, 30K uncached TPM and 1M TPD on `gpt-oss-120b`/`qwen-3.8-27b`. ([Rate limits](https://inference-docs.cerebras.ai/support/rate-limits), [Pricing](https://www.cerebras.ai/pricing)) The privacy policy says "We do not retain inputs and outputs associated with our … inference … Services" ([Privacy policy](https://www.cerebras.ai/privacy-policy), effective 2024-08-27). **Out:** it isn't $0 after 30 days, and it needs a card.

### 1.8 Hugging Face Inference Providers

Monthly credits: "**Free Users | None**". PRO is $2/month (on a paid subscription). Free users must buy credits. ([Pricing and billing](https://huggingface.co/docs/inference-providers/pricing)) **Out.**

---

## 2. Content policy across the field (crude British banter)

| | Profanity | Crude insults between fictional characters | Accent/dialect | Sexual innuendo |
|---|---|---|---|---|
| Gemini | Not mentioned. Filters off by default | Harassment filter off by default | Not mentioned | Explicit sex is blocked by the model. Innuendo is likely fine (INFERENCE) |
| Groq | Not mentioned | AUP: "harass … individuals or specific groups". Fictional orcs aren't individuals (INFERENCE) | Not mentioned | Only "illegal" explicit content is banned |
| Cloudflare | Not mentioned. The model provider's AUP applies | Same | Not mentioned | Same |
| Mistral | Not mentioned | "Harassing language towards **any** target": the strictest wording | Not mentioned | No general clause |

No provider's policy mentions accents or dialect. The tone bible already bans phonetic respelling and identity punchlines, which is the part a filter would catch. **INFERENCE about refusal behaviour (not from sources):** OpenAI's `gpt-oss` models are safety-tuned like OpenAI's API models. They will usually swear in fiction once a system prompt allows it, but they're the most likely of these to soften the c-word or the "your mum" lines. Llama 3.3 and Mistral models are generally more permissive with profanity. Gemma is moderately cautious. The cheapest way to settle this is to run the tone bible's §6 calibration samples through each candidate.

## 3. Stability history (dated, from the sources above)

- GitHub Models: retired 2026-07-30.
- Cerebras: its free offer is now a $5/30-day trial ("doesn't currently offer a no-cost tier that renews").
- Hugging Face: free users get **no** monthly credits.
- Groq: Llama 3.1/3.3 now carry an **Enterprise** tag. The free table lists only gpt-oss, Qwen preview, guard and speech models.
- Gemini: free-tier numbers have been taken off the docs (now "View … in AI Studio"). The Pro models aren't on the free tier. Third-party reports of April 2026 cuts are **UNCERTAIN** (secondary only).
- OpenRouter: free models carry expiry dates, two of them in two days. Free daily caps depend on buying credits.
- Cloudflare: no cut found in these sources. The 10k Neurons/day allowance is the long-standing figure. **UNCERTAIN:** I didn't trace its history.

**INFERENCE:** every free tier here can change without notice. Design for it with provider-agnostic prompts, the OpenAI-compatible request shape (all the survivors offer it), a JSON check in our code, and the templated fallback.

## 4. Ranked shortlist

1. **Cloudflare Workers AI** — fits the full load on a mid-size model, can't bill us, doesn't train or retain, and is native to a Worker. The weak points are thin structured-output guarantees and unknown banter quality per model.
2. **Groq free (`openai/gpt-oss-120b`, or `qwen/qwen3.8-27b`)** — strict JSON schema, very fast, ZDR available, and caching keeps us under the token limits. The weak points are the 200K TPD cap, a Qwen that's only in preview, and gpt-oss prudishness (INFERENCE).
3. **Mistral free mode** — no card, permissive models (INFERENCE), and training can be switched off. The weak points are unpublished limits, the strict policy wording, and training on by default.
4. **OpenRouter `:free`** — 50 RPD without a $10 top-up, churning models, and trial or research data terms.
5. **Gemini free** — barred for UK users, and outside the UK it trains on prompts and has humans review them.
   Out: GitHub Models (retired), Cerebras (trial), Hugging Face (no free credits).

## 5. Recommended $0 setup

- **Host narration in the Cloudflare Worker.** Call Workers AI through the `AI` binding.
  - Primary model: **`@cf/google/gemma-4-26b-a4b-it`** (~19 Neurons per Clash). Or use **`@cf/meta/llama-3.3-70b-instruct-fp8-fast`** if it wins the bake-off and the day's Clash count stays near 100. Keep a daily Neuron counter in the Worker. When it nears ~9,000, switch to the fallback.
  - Validate the JSON in code: 2–4 lines, known speaker ids. On a parse failure, retry once on the fallback, not the same model.
- **Fallback: Groq `openai/gpt-oss-120b`.**
  - Set `response_format: {type: "json_schema", strict: true}` and `reasoning_effort: "low"`.
  - Put the tone bible as a byte-identical prefix so cached tokens don't count against TPM/TPD.
  - **Turn ZDR on** in Data Controls before the first call. Read the 429 headers and route straight to the templates.
- **Last resort:** the rules-engine templated lines the tone bible already requires.
- **Optional third tier:** Mistral free mode, with the training toggle off. Only add it if the bake-off shows it writes the best banter.
- **Bake-off before committing (one evening):** run the §6 calibration samples and 20 synthetic Clashes through Gemma 4 26B, Llama 3.3 70B and Mistral Small 3.1 on Workers AI, plus gpt-oss-120b on Groq. Score them on heat kept, c-word handling, accent by word choice only, and JSON validity.

## 6. Not verified

- The exact Gemini free RPM/RPD for any model (published only in AI Studio).
- Whether the Groq table is the Free or Developer plan, given the page's contradictory sentence.
- Mistral's free-mode numbers, and whether it requires phone verification.
- Training and retention terms for OpenRouter's free providers (the Thinking Machines and NVIDIA PDFs).
- How Workers AI bills reasoning tokens, and its latency. Groq latency.
- Banter quality and refusal behaviour of every model. No model was called in this research.
- Whether Groq's free plan restricts commercial use (the Services Agreement wasn't reviewed). Not material for a private game.
