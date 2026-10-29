# ORC NONSENSE: MVP design

Label: wayfinder:map

## Destination

A **locked MVP spec** for ORC NONSENSE: [gdd.md](./gdd.md) plus its decision log, with every question below resolved, ready to hand to a separate implementation effort.

## Notes

- Domain: comedic game design for a private friend group. The north star is "a world of spectacularly stupid orcs whose behaviour becomes running jokes", **not** a combat game.
- Mohammed plans alone. HITL tickets are worked with him.
- Every session reads [GLOSSARY.md](../../GLOSSARY.md) and uses the **grilling** and **domain-modeling** skills by default. Glossary terms are updated inline.
- Standing decisions from the brainstorm and brief (not tickets): outside interference only · frequent events · non-permanent death · minimal v1 · original content only (no Shadow of War / Tolkien / Mike Brooks names or lines) · stack React/TS PWA + Supabase free + Cloudflare + a free LLM (Workers AI, with Groq as fallback; Haiku 5.5 dropped by [Narration tiers and tick budget](issues/11-narration-tiers-and-tick-budget.md)) + ElevenLabs · the rules sim owns canonical state, the LLM only narrates Facts. See [gdd.md §10](./gdd.md).
- Plan, don't build: no production code on this map. Throwaway prototypes only.

## Decisions so far

- [Destination and first principles](issues/01-destination-and-first-principles.md): locked MVP spec is the goal; async-first; Backing pays on wins and Infamy; Infamy decides the Warlord; Krúg (accent on the u) is the founding Captain; content "all out" (boundary still open); score still open.
- [Free-tier platform limits](issues/02-free-tier-platform-limits.md): the free stack works if a Cloudflare cron Worker owns the tick (adaptive 1 to 5 min) with Supabase as canonical store, and sends one Realtime broadcast per tick; risks are Supabase's vague pause rule and the 10 ms Worker CPU budget.
- [AI and voice costs](issues/03-ai-and-voice-costs.md): running costs are pennies to a few dollars a month (Haiku 5.5 with thinking off, caching, Batch for the Herald; one ElevenLabs Starter month to prerender all audio); policy allows profanity and crude fictional insults but not protected-group humour or explicit sex, so edgier lines must be hand-written.
- [Score or no score](issues/04-score-or-no-score.md): no win state or ranking; instead loud, unranked Blame for every consequence of a Player's Meddles, a rap sheet per Player, gold as fuel only, open Stables, and rare, often-wrong Accusations where an orc names a Player.
- [Tone bible and content boundaries](issues/05-tone-bible-and-content-boundaries.md): everything goes except punching at identity (the swap test: accents are voices, never punchlines). Full profanity, innuendo but nothing explicit, Brexit as a register only, all-male cast with off-screen women as gags. Prerecorded lines are hand-written, Clash dialogue and the Herald are generated. The daily report is The Gutter Herald. Rules and samples in [tone-bible.md](./tone-bible.md).
- [Captain card and name generator](issues/06-captain-card-and-name-generator.md): a fixed, hand-written cast of about 30, each with one portrait plus overlays and one unique voice. Card is 2 Traits + 1 Fear, Power 1–10, Infamy, one Epithet, two disguise aliases. Six accent archetypes, with muffled as an overlay. Guttural or compound-English names with say-as respellings. Captains shout their own names badly, and the announcer adds the Epithet from a prerecorded bank. Krúg (cockney, Mummy's Boy, Little Fortresser, fears Water, Power 3) doesn't start as Warlord.
- [Meddle verbs and misfires](issues/07-meddle-verbs-and-misfires.md): the MVP verbs are Rumour and Dare (Gift later), 3 a day banked to 6, no gold, no fizzles, a 10–90 minute delay, and secret until Blame reveals them. Rumours are picked from 5 Claim kinds and work, reach the wrong orc or Garble up an escalation ladder (50/30/20). Dares are stunts or pranks from a tagged bank, offered 3 at a time, and get botched, pulled off or refused (60/20/20).
- [Backing economy](issues/08-backing-economy.md): a 10-gold daily Stipend banked to 30 (no reset, overflow lost). Backing is a standing Stake, withdrawable for half back and held through death. It gives a flat +5% Clash-only edge per backer (max +10%) and pays 10% of the Stake per win and 1% per Infamy point, so idiots pay best. Who backs whom is public; amounts are private.
- [Free LLM API options](issues/12-free-llm-api-options.md): the best $0 setup is Cloudflare Workers AI (10k Neurons a day, fails rather than bills, no training on prompts) with Groq gpt-oss-120b as fallback (zero retention on). Gemini free is unusable from the UK, GitHub Models is gone, and no model's banter has been tested yet.
- [Narration tiers and tick budget](issues/11-narration-tiers-and-tick-budget.md): every Clash gets generated dialogue and the Herald is generated on open. Notable events get template lines and minor state changes stay silent. No runtime TTS. $0: Workers AI as primary, Groq as fallback, templates as the last resort, and the free quota is the cap. Ticks run every 1 minute when watched and every 5 when not. The Worker is the clock, a Supabase Edge Function runs the tick, and narration never blocks it.
- [Clash and Introduction cards](issues/10-clash-and-introduction-cards.md): Fight Night staging for both, auto-play with tap to skip, about 15 s and 3 lines per Clash (4 with a wrong saviour, who crashes in as a hard interruption), and about 7 s per Introduction. Barks and stingers are prerecorded and lines are subtitles. Outcome stamp, then Trophy, then Blame line. The shareable card is a Herald clipping with the loser's last line as a pull quote.

## Not yet specified

- **Event catalogue v1**: how many event templates, their preconditions and effects, and how comedy weight is scored. Needs the Meddles and Failing Upward rules first. Every v1 Trait and Fear must have at least one event that uses it. Also includes the Dare bank (~30–40, tagged by Fear and Trait), the Rumour subject and escalation banks, and reaction events for each Claim kind.
- **The Herald's structure**: how "Since You Left" is ranked, how long it is, what gets the announcer voice, and push-notification triggers. Also how Blame is traced back in headlines and where Accusations fit (at most about one per Herald). No recurring awards in the MVP. Plus a private, per-Player section for gold payouts and Stable news (the Herald itself never names gold).
- **Hall of Shame**: what's archived and how it's browsed, and how it relates to each Player's rap sheet. A view, not a system.
- **Portrait pipeline**: one curated portrait per Captain (~30), with Humiliation and disguise overlays (bandages, mouth bandages for muffled, eyepatches, buckets, bad moustaches) composited on top. How the overlays are made and layered.
- **Voice casting**: whether ElevenLabs Voice Design can produce about 30 distinct voices across six archetypes (cockney, RP, West Country, Scouse, Glaswegian, Indian English; cockney, RP and Indian English were flagged by the research), a muffled version of each Captain's own voice, and the announcer.
- **Onboarding**: inviting friends, creating a world, the first session's experience (Krúg's Introduction?).
- **The final data model and sim interface**: graduates once narration, tick budget and the mechanics rules are settled. Must record Meddle → consequence causal links so Blame can follow the whole chain, plus pending Meddles with fuse times and Meddles held on dead Captains, and Stakes (including those held on dead Captains) and each Player's banked gold.

## Out of scope

- Implementation of any kind (a later, separate effort).
- Multiple fortresses, maps, travel, real-time or turn-based combat.
- Monetisation and public or multi-group worlds.
- The Gift Meddle (cursed or embarrassing items): it needs its own item and overlay bank. Ruled out of the MVP in [Meddle verbs and misfires](issues/07-meddle-verbs-and-misfires.md).
