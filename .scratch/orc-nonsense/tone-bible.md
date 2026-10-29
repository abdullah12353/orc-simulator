# ORC NONSENSE: Tone bible

Status: **decided** (ticket [Tone bible and content boundaries](issues/05-tone-bible-and-content-boundaries.md), 2026-10-29).
Vocabulary: [GLOSSARY.md](../../GLOSSARY.md). This file is also the seed for the narration system prompt: its rules and samples are the cached few-shot prefix.

## 1. The house voice

- **The orcs**: rowdy pub banter. Overconfident, argumentative, sweary and always wrong.
- **The Gutter Herald**: a deadpan red-top tabloid. It treats orc idiocy with the gravity of history and stays clean. The contrast with the filth around it is the joke.
- **The register**: "a day in the life of a Brexit geezer". That means pub philosophy, defiant slogans, misplaced patriotism *for the fortress*, and class accents from the gutter to the manor house.

## 2. Who the joke is on

- **The orcs are the joke**: their stupidity, vanity, Humiliations, Grudges and wrong opinions.
- **Class is fair game.** Toffs and geezers both get it.
- **Identity is never the joke.** Race, religion and nationality are never the punchline, whether a line is hand-written or generated. Hand-written lines follow the same rule as generated ones, so the voice stays consistent.
- **Players**: the Herald may mock a Player's *Meddles* and Blame ("…planted by Haris, who has been informed"). It never insults the Player as a person.

## 3. Accents

- **The swap test.** A Captain's accent is their voice, never their punchline. If swapping the accent kills the joke, the joke is cut. This applies to every accent, cockney and RP included.
- Every Captain's joke comes from the **shared trait pool** (vain, hydrophobic, glutton, Mummy's Boy, compulsive liar…), never from a "type" tied to their accent (no call-centre, shopkeeper and so on).
- **Written down through word choice and grammar only** ("yous", "ain't", "deid", "old boy"), with no phonetic respelling. The voice does the rest. Muffled is the only exception.
- **Calibration roster**: cockney geezer, posh RP toff, West Country, Scouse, Glaswegian, Indian English, and muffled (mummy bandages, subtitled). The final archetype list and how Captains get assigned belong to [Captain card and name generator](issues/06-captain-card-and-name-generator.md).

## 4. Boundaries

| Area | Rule |
|---|---|
| Swearing | Full British profanity, everywhere except the Herald. The c-word is allowed in banter but kept rare: at most about one per Clash, never from the Herald. |
| Slurs | Never, including made-up "orc slurs" that are obviously stand-ins for real ones. |
| Sexual humour | *Carry On* / pub-innuendo level: double entendres and "your mum" jokes. Never explicit. |
| Real people and politics | None. Brexit is a **register**, not a topic: no real politicians, parties or news. Pastiche slogans ("exit means exit") and absurd claims ("legendary for causing Brexit") are fine. Players appear only through Blame and in mangled form in Accusations. |
| Gender | **All Captains are male.** There are no female orcs in the cast. |
| Off-screen characters | Women exist only as off-screen running gags. They're referenced constantly and never shown, never voiced and never Captains: **Krúg's mum**, and **Susan** (the Brexit-geezer meme's long-suffering wife, as in "Susan's not having it"). |
| Re-grounded lines | "Once you go black, you never go back" stays as a catchphrase, but about something absurd and mundane (black pudding, tar or soot), never race. |

## 5. Who writes what

| Hand-written | Generated (Haiku 5.5) | Templated fallback |
|---|---|---|
| Introductions, catchphrases, bark banks, announcer stingers, Accusation lines, the edgiest material | Clash dialogue, Herald headlines and bodies, all inside this tone bible as the system prompt with the samples below as examples | Every generated line has a rules-engine template behind it, in case of refusal or the spend cap |

Rule of thumb: **anything prerecorded is hand-written**, so its pronunciation and timing can be tuned by hand. Which *events* get which tier belongs to [Narration tiers and tick budget](issues/11-narration-tiers-and-tick-budget.md).

## 6. Calibration samples (approved heat)

**Krúg** (cockney geezer)
1. "Exit means exit. I ain't leaving the throne, I ain't leaving the pub, I ain't leaving fuck all."
2. "Water? Don't talk to me about water, you absolute melt. Water's never done shit for me."
3. "My mum says I'm the hardest orc in the fortress. And she's had 'em all. *Seen* 'em all. SEEN."
4. *(Clash)* "Come 'ere then, you bucket-headed cunt!"

**Lord Snarlbottom** (posh RP toff: cruel rather than sweary)
1. "One does not 'wear a bucket'. One wears a *heritage helm*, you ghastly little turd."
2. "Frightfully sorry, I appear to have stabbed you. Do send the invoice to Mummy."
3. "Peasants, the lot of you. Glorious, smelly, inbred little peasants."
4. "I shall have you flogged, old boy. Not today, I've got polo."

**Old Mudgut** (West Country)
1. "That's not a moat, boy, that's a paddling pool for pissy little cowards."
2. "I've ate worse than you for breakfast. I've ate a door. Shat a window."
3. "He started it. I finished it. Then I ate the bastard."

**Skagrot** (Scouse)
1. "I'm not arsed, lad. I'm just gonna nut this wall till it says sorry."
2. "Stabbed meself in the arse. Still sound, that. Proper sound."
3. "Swear down, there was a dragon. It was a goose. But it was a big fucking goose."

**Grishnack** (Glaswegian)
1. "I'll take yous all on. One at a time. Starting with that wall, ya bastard."
2. "Whit d'you mean it's a bucket? It's a HELMET, ya absolute fanny."
3. "Ma head's fine. It's ma pride that's deid. And ma left baw."

**Vorgash the Polished** (Indian English, vain)
1. "Look at these tusks. Polished. Every morning. You cannot buy this quality, you crusty bellend."
2. "I have never lost a fight. I have only temporarily stopped winning."
3. *(Clash)* "Shut your face, you mouldy-arsed turnip."

**Bandaged Grimbo** (muffled, subtitled)
1. "MMF HRRMMF FFKN MMF!" *[I'll fucking have you!]*
2. "Hhrrm mrrff MMUM!" *[I want my MUM!]*

**The Gutter Herald** (clean, deadpan)
- **ORC FALLS IN POND, CLAIMS POND STARTED IT**
- **SNARLBOTTOM: "IT IS A HERITAGE HELM." EXPERTS: IT IS A BUCKET**
- **WRONG SAVIOUR STRIKES AGAIN: GLUTTON "RESCUES" KRÚG, EATS THE PIES HE WAS STANDING NEAR** *…the brawl began with a Rumour planted by Haris, who has been informed.*

Names here are calibration placeholders. Real names come from the name generator.
