# Narration tiers and tick budget

Type: grilling
Status: resolved
Assignee: Mohammed
Blocked by: 02, 03, 05

## Question

Which events get generated narration, which get templates, and which get none? What are the tick intervals online and offline? What is the hard daily spend cap, and what happens when it's reached?

Uses the facts from [Free-tier platform limits](02-free-tier-platform-limits.md) and [AI and voice costs](03-ai-and-voice-costs.md), and the hand-written vs generated split from [Tone bible and content boundaries](05-tone-bible-and-content-boundaries.md).

## Answer

Resolved with Mohammed on 2026-10-29 (three grilling rounds, plus [Free LLM API options](12-free-llm-api-options.md) researched mid-session).

### Narration tiers

| Tier | What gets it |
|---|---|
| **Generated** (free LLM) | Clash dialogue (2–4 lines) for **every** Clash, watched or not, so overnight Clashes can be replayed from the Herald. Herald headlines and bodies. |
| **Templated** | A one-line rules-engine log entry for every notable event: a Rumour landing, a Dare outcome, death, Return, Humiliation, a Trophy, a Warlord change, an Accusation. The Herald generates its text from these Facts. Also the fallback for every generated line. |
| **Silent** | State changes with no text: affinity drift, small Infamy ticks, ambient movement. They show only as numbers or on the portrait. |

Introductions, barks, stingers and Accusation lines are hand-written and prerecorded, so they never touch these tiers.

- **Clash call inputs:** a fixed prefix (the tone bible plus samples, kept identical so cached tokens are used where the provider supports it), then the Clash Fact (who, why, outcome, any wrong saviour, Trophy), both Captain cards, the Grudge tags between them, and the Player's optional free-text Rumour line. Blame and Accusations never go to the model.
- **No retries:** any refusal, timeout or bad output means the template is final for that event. Every failure is logged to measure the refusal rate.
- **The Herald is generated on open**, never as a batched daily edition. A new edition is generated when there are at least 3 new templated events since the last one, or 30 minutes have passed and at least one has happened. Otherwise the last edition is shown again.
- **No runtime TTS.** The announcer plays prerecorded stingers plus the Captain's name and Epithet from the banks, and the headline appears as text. Voicing headlines at runtime is reserved for later.

### Provider

- **$0, hard.** No paid backstop. Haiku 5.5 is dropped from D6.
- **Primary: Cloudflare Workers AI** (no training on or retention of prompts; calls fail rather than bill when the allowance runs out). **Fallback: Groq `gpt-oss-120b`** with zero retention on. Templates are the last resort.
- A daily Neuron counter switches Clash calls to Groq at about 9k of the 10k allowance. There's no retrying across providers on a failure.
- Friends' free-text Rumour lines stay in the prompt, because neither provider trains on prompts.
- **The model is chosen by [Narration model bake-off](13-narration-model-bake-off.md)** (Gemma 4 26B vs Llama 3.3 70B on Workers AI, and Groq `gpt-oss-120b`).

### Spend cap

- The cap is the free quota itself, so there's no money cap. When a provider's daily allowance is close to used up, calls go to the next one, and after the last one, to templates. Clash calls stop just short of Groq's daily limit, which leaves a small remainder for the Herald. When everything is used up, the Herald falls back to templated headlines. Players see nothing about this, and no "budget exhausted" message is shown. Allowances reset daily.

### Tick

- **Watched:** a tick every 1 minute. "Watched" means any Player was seen in the last 5 minutes. **Unwatched:** every 5 minutes. No overnight pause.
- **The Worker is only the clock.** It calls a Supabase Edge Function that runs the whole tick in TypeScript (2 s CPU instead of the Worker's 10 ms). That external call also counts as Supabase activity against the pause rule.
- **The tick never waits for the LLM.** It writes Facts and commits, and narration runs out of band. The client shows the template until generated text arrives. A live Clash plays its template if the dialogue isn't ready within a few seconds.
- **One Realtime broadcast**, sent only on ticks that changed something while the world is watched.
- **Pacing:** the client spreads a tick's events across the minute, so set pieces play one after another with log lines between them.

**Effects on the map:**
- New ticket: [Narration model bake-off](13-narration-model-bake-off.md).
- The *Voice casting* fog loses the runtime-TTS pronunciation question.
- D6 is amended: free LLM instead of Haiku 5.5.

## Comments
