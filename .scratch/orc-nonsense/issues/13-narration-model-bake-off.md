# Narration model bake-off

Type: prototype
Status: open
Blocked by: (none)

## Question

Which model writes ORC NONSENSE's generated lines: Gemma 4 26B or Llama 3.3 70B on Cloudflare Workers AI, with Groq `gpt-oss-120b` as the fallback? And do the free-tier quotas actually hold?

Build a throwaway script that runs the [tone bible](../tone-bible.md) calibration samples, plus about 30 sample Clash Facts and 2–3 Herald inputs, through each model using the prefix and inputs set in [Narration tiers and tick budget](11-narration-tiers-and-tick-budget.md). Mohammed rates the output blind, side by side, for:

- **Funniness and voice:** does it sound like the tone bible? Does it pass the swap test?
- **Refusals and softening:** how often does it decline, sanitise or lecture?
- **Format:** valid JSON, 2–4 lines, respects the Facts (never changes the outcome).
- **Cost to quota:** real tokens per call, Neurons per Clash on Workers AI, and whether Groq's cached prefix tokens are really excluded from its daily token cap. Also latency.

Background: [Free LLM API options](12-free-llm-api-options.md).

## Comments
