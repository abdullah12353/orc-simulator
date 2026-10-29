# Captain card and name generator

Type: grilling
Status: resolved
Assignee: Mohammed
Blocked by: (none)

## Question

What exactly is a Captain, as data? And how are their names made?

- Fields: Power, Infamy, traits (how many, from what list), fear/weakness, accent archetype, voice, catchphrase, epithet, Humiliations, Trophies held, portrait description. What's the minimum set that still produces distinct personalities?
- Name generator rules for the "guttural German-English" sound (syllable tables, epithets like "the Damp", "Bootleg" variants). How should pronunciation be represented so Introductions shout it correctly?
- How do the ~30 hand-curated portraits map to Captains (one-to-one? are Return disguises extra portraits)?
- Krúg's own card as the worked example.

## Answer

Resolved with Mohammed on 2026-10-29 in three grilling rounds.

### The cast

- **A fixed cast of about 30, written ahead of time.** Captains are never generated at runtime, because their Introductions, catchphrases and barks are prerecorded and therefore hand-written. Since death isn't permanent, the cast never runs out.
- The **name generator** is an **offline writing aid** for naming the cast, plus a **runtime combiner** that picks from finite prerecorded banks (Epithets, disguise aliases).
- **Portraits map one-to-one**: each of the ~30 curated portraits belongs to one Captain. Disguises, bandages, eyepatches and buckets are **overlays** on the base portrait, never extra portraits.

### The card (minimum set)

| Field | Shape |
|---|---|
| Name | fixed; display spelling + say-as respelling |
| Epithet | at most one current one; older ones kept in history |
| Aliases | two hand-written disguise aliases, prerecorded in his own voice |
| Power | integer 1–10 |
| Infamy | integer from 0, no cap |
| Traits | exactly 2 from the shared pool |
| Fear | exactly 1 to start; Humiliations can add more |
| Accent archetype | one of six |
| Voice | unique to the Captain |
| Catchphrase | one, hand-written, passes the swap test |
| Humiliations | list (rules belong to [Failing Upward rules](09-failing-upward-rules.md)) |
| Trophies | list of tags: item + who it was taken from |
| Portrait | portrait id + active overlays |
| Status | active / reserve / dead (awaiting Return) / Warlord |

- **Grudges and affinity live on pairs of Captains**, not on the card.
- "Weakness" is folded into **Fear**.
- The **Brexit geezer is a Trait** (*Little Fortresser*), not a field or an accent type. Any accent can carry it, and it is weighted to be common.

### Pools (v1; [Event catalogue v1](../map.md) may rename or cut)

- **Traits (16):** Glutton, Vain, Mummy's Boy, Compulsive Liar, Little Fortresser, Coward, Hothead, Gullible, Drunkard, Snob, Hoarder, Superstitious, Show-off, Lazy, Sore Loser, Sleepwalker.
- **Fears (10):** Water, Heights, The Dark, Birds (geese especially), Doctors, Soap, Cats, Being Laughed At, Small Dogs, His Mum.
- Every Trait and Fear has to give events something to trigger on.

### Accents and voices

- **Six accent archetypes:** cockney, posh RP, West Country, Scouse, Glaswegian, Indian English (about 5 Captains each). Brummie, Geordie, Welsh, Yorkshire and Irish are post-MVP.
- **Muffled is a Humiliation overlay**, not an archetype. Any Captain can get it, and it muffles *his own* voice.
- **One designed voice per Captain** (about 30), all prerendered in the single ElevenLabs Starter month.

### Names

- **Two forms**, either of which goes with any accent:
  - **Guttural** (default): one or two syllables. A hard cluster at the start (Kr, Gr, Sk, Sn, Vr, Gl), a fat vowel (u, o, a), and a hard ending (-g, -k, -ack, -rot, -gash, -nak). Syllable tables. Examples: Krúg, Grishnack, Skagrot, Vorgash.
  - **Compound English** (about 1 in 5): a crude English word pair (Snarlbottom, Mudgut). Can take a class title (Lord, Old, Big). Word-pair tables.
- **Diacritics** are allowed in display spellings but rare, used as flair.
- **"Badly pronounced"** means **the Captain shouts his own name badly** (stretched vowels, rolled R, wrong stress, spit: "KRRRÚÚÚG!"). The announcer is always deadpan and correct.
- **Pronunciation**: each name, alias and Epithet has a **say-as respelling** (Krúg → KROOG). It is the voice direction for prerendering, and the alias in an ElevenLabs pronunciation dictionary for the Herald's runtime TTS.
- **Epithets**: a finite bank of about 40, hand-written, each tagged by the kind of disaster that earns it (drowning → "the Damp"), and each prerendered **in the announcer's voice**. An Introduction stitches together the Captain's own name shout and the announcer's Epithet, so any Captain can wear any Epithet. About a third of the cast starts with one (Vorgash the Polished).
- **Disguise aliases**: two per Captain, written from a pattern bank ("<Name> Bootleg", "Not-<Name>", an anagram like "Gúrk", or a hopeless human name like "Kevin"). When a disguise happens belongs to Failing Upward.

### Starting state

- **Power is spread on a bell curve** at casting: mostly 3–6, a couple of 8s and 9s, nobody at 10. The starting Warlord is among the highest. Whether Power changes belongs to Failing Upward.
- **Krúg doesn't start as Warlord.** The first Warlord is a competent-looking Captain from the cast.

### Worked example: Krúg

| Field | Krúg |
|---|---|
| Name | **Krúg** (say-as KROOG); shout "KRRRÚÚÚG!" |
| Epithet | none (earns "the Damp" in the GDD chain) |
| Aliases | Krúg Bootleg, Kevin |
| Power / Infamy | 3 / 0 |
| Traits | Mummy's Boy, Little Fortresser |
| Fear | Water |
| Accent archetype | cockney |
| Voice | his own: geezer, gravelly, too loud |
| Catchphrase | "Exit means exit." |
| Humiliations / Trophies | none |
| Portrait | his own, no overlays |
| Status | active, **always in the active 12** |

**Effects on the map:**
- Unblocks [Meddle verbs and misfires](07-meddle-verbs-and-misfires.md) and [Failing Upward rules](09-failing-upward-rules.md). [Clash and Introduction cards](10-clash-and-introduction-cards.md) is now unblocked too, and gets the stitched name-shout + announcer-Epithet structure.
- The *Voice casting* fog now has its final list: six archetypes, the muffled overlay, about 30 unique voices, an announcer, and a pronunciation dictionary.
- The *Portrait pipeline* fog now has: one-to-one mapping, with overlays for Humiliations and disguises.
- The cast itself (about 30 cards, Epithet bank, aliases) is writing work for the implementation effort, using these rules.

## Comments
