# ORC NONSENSE: MVP design

Label: wayfinder:map

## Destination

A **locked MVP spec** for ORC NONSENSE: [gdd.md](./gdd.md) plus its decision log, with every question below resolved, ready to hand to a separate implementation effort.

## Notes

- Domain: comedic game design for a private friend group. The north star is "a world of spectacularly stupid orcs whose behaviour becomes running jokes", **not** a combat game.
- Mohammed plans alone. HITL tickets are worked with him.
- Every session reads [GLOSSARY.md](../../GLOSSARY.md) and uses the **grilling** and **domain-modeling** skills by default. Glossary terms are updated inline.
- Standing decisions from the brainstorm and brief (not tickets): outside interference only · frequent events · non-permanent death · minimal v1 · original content only (no Shadow of War / Tolkien / Mike Brooks names or lines) · stack React/TS PWA + Supabase free + Cloudflare + Haiku 5.5 + ElevenLabs · the rules sim owns canonical state, the LLM only narrates Facts. See [gdd.md §10](./gdd.md).
- Plan, don't build: no production code on this map. Throwaway prototypes only.

## Decisions so far

- [Destination and first principles](issues/01-destination-and-first-principles.md): locked MVP spec is the goal; async-first; Backing pays on wins and Infamy; Infamy decides the Warlord; Krúg (accent on the u) is the founding Captain; content "all out" (boundary still open); score still open.
- [Free-tier platform limits](issues/02-free-tier-platform-limits.md): the free stack works if a Cloudflare cron Worker owns the tick (adaptive 1 to 5 min) with Supabase as canonical store, and sends one Realtime broadcast per tick; risks are Supabase's vague pause rule and the 10 ms Worker CPU budget.
- [AI and voice costs](issues/03-ai-and-voice-costs.md): running costs are pennies to a few dollars a month (Haiku 5.5 with thinking off, caching, Batch for the Herald; one ElevenLabs Starter month to prerender all audio); policy allows profanity and crude fictional insults but not protected-group humour or explicit sex, so edgier lines must be hand-written.
- [Score or no score](issues/04-score-or-no-score.md): no win state or ranking; instead loud, unranked Blame for every consequence of a Player's Meddles, a rap sheet per Player, gold as fuel only, open Stables, and rare, often-wrong Accusations where an orc names a Player.

## Not yet specified

- **Event catalogue v1**: how many event templates, their preconditions and effects, and how comedy weight is scored. Needs the Captain card, Meddles and Failing Upward rules first.
- **The Herald's structure**: how "Since You Left" is ranked, how long it is, what gets the announcer voice, and push-notification triggers. Also how Blame is traced back in headlines and where Accusations fit (at most about one per Herald). No recurring awards in the MVP.
- **Hall of Shame**: what's archived and how it's browsed, and how it relates to each Player's rap sheet. A view, not a system.
- **Portrait pipeline**: turning ~30 curated images into Captain cards, plus Humiliation overlays and disguise variants.
- **Onboarding**: inviting friends, creating a world, the first session's experience (Krúg's Introduction?).
- **The final data model and sim interface**: graduates once narration, tick budget and the mechanics rules are settled. Must record Meddle → consequence causal links so Blame can follow the whole chain.

## Out of scope

- Implementation of any kind (a later, separate effort).
- Multiple fortresses, maps, travel, real-time or turn-based combat.
- Monetisation and public or multi-group worlds.
