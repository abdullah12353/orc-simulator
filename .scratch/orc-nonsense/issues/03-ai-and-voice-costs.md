# AI and voice costs

Type: research
Status: resolved
Blocked by: (none)

## Question

What does it actually cost, and what is actually permitted, to narrate with Claude Haiku 5.5 and voice with ElevenLabs at friend-group scale?

- **Claude Haiku 5.5** (`claude-haiku-5-5`): per-token input/output pricing, prompt caching pricing and minimum cacheable length, Batch API discount and latency, structured output / JSON support.
- **Anthropic usage policy** as it bears on crude, profane, uncensored comedy, insults between fictional characters, and accent/dialect writing. Where would the model likely decline or water down?
- **ElevenLabs**: plan tiers and character quotas, cost per character, voice design / voice library options for British regional and class accents, and whether generated audio can be cached and replayed indefinitely on the free/starter tier. Also its content policy on profanity.
- A worked estimate: ~12 Captains × ~20 prerecorded barks + ~30 Introductions + announcer stingers (one-off), plus a daily budget of N featured narrations and 1 Herald.

Primary sources only (official docs and pricing pages), dated.

## Answer

Full findings: `research/ai-and-voice-costs.md` on branch [`research/ai-and-voice-costs`](https://github.com/abdullah12353/orc-simulator/blob/research/ai-and-voice-costs/research/ai-and-voice-costs.md) (never merged).

- **Cost isn't a constraint.** Haiku 5.5 is $0.10/MTok in and $0.50/MTok out. Narration costs about $0.25–0.75 a month at 50 featured events/day, about $0.90–1.45 at 200, and about $2.60–5.15 at 1,000.
- **Thinking:** Haiku 5.5 thinks by default and bills it as output. Send `thinking: {type: "disabled"}` or the bill roughly doubles.
- **Caching:** the shared prompt prefix must be at least 512 tokens to cache. The Herald can use the Batch API (50% off, up to 24 h).
- **Structured output:** JSON schemas are supported. The 2–4 line limit has to be checked in code.
- **Refusals** are billed and don't fall back automatically. Every narration needs a templated fallback from the rules engine.
- **Usage policy:**
  - **Allowed:** profanity, crude banter, and fictional insults between Captains. British regional and class accents are fine.
  - **Not allowed:** slurs and protected-group humour (race, religion, *national origin*), and explicit sexual content.
  - **Likely softened:** an ethnicity-as-punchline Indian-accent Captain, and crude sexual jokes. A new policy version takes effect 2026-11-12.
- **ElevenLabs:**
  - **Tier:** Starter ($6/mo) is the minimum usable tier. The Free tier is non-commercial, needs attribution, and can't use Library voices via the API.
  - **Rate:** about $0.08 per 1k characters on v4/v3.
  - **One-off voice work:** about 15–46k characters, roughly $1–4 in total, so it fits in one Starter month.
  - **Rights:** generated audio is yours to keep and replay indefinitely. There's no rule against profanity.
  - **Voices:** prefer **Voice Design** over Library voices, which can be withdrawn. The cockney, RP and Indian-English accents still need prototyping.
- **Cheapest setup:**
  1. One Starter month to render all barks, Introductions and stingers, then cancel.
  2. Run the Herald through the Batch API.
  3. Send narrations with thinking off and a cached prefix of at least 512 tokens.
- **Still open:** ElevenLabs' Starter quota is inconsistent between its pages (30k vs 75k), and the real token counts and refusal rate need measuring on about 30 sample events.
- **What this means for the open tickets:** the content boundary is now a **policy** question as well as a taste question, which feeds [Tone bible and content boundaries](05-tone-bible-and-content-boundaries.md). Anything beyond what the policy allows can only come from **hand-written** lines.

## Comments
