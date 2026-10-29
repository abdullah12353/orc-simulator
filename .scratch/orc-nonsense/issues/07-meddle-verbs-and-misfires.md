# Meddle verbs and misfires

Type: grilling
Status: resolved
Assignee: Mohammed
Blocked by: 06

## Question

Which Meddles can a Player make in the MVP, how many per day, and how exactly does a Rumour land, misfire, or get misunderstood?

- Is the Rumour the only verb, or do Gift and Dare earn a place?
- Rumour authoring: free text (LLM-parsed), a template picker ("<A> says <B>'s <thing> is <insult>"), or both?
- The misfire and misunderstanding rules, and whether a Captain ever learns *which Player* started it.

## Answer

Resolved with Mohammed on 2026-10-29 (two grilling rounds).

### Verbs and allowance

- **MVP verbs: Rumour and Dare.** Gift is reserved for a later iteration, because it needs its own item and overlay bank.
- **3 Meddles per Player per day, banked up to 6.** Meddles cost **no gold**. Gold is only for Backing.
- **No fizzles.** Every Meddle produces a visible consequence. "Nothing happened" is never shown.
- **Delayed fuse.** A Meddle takes effect after a random 10–90 minutes, so the punchline usually lands while you're away.
- **Secret until it lands.** Pending Meddles are hidden from other Players, and Blame reveals them in the Herald once they cause something. Players can unknowingly meddle with the same Captains and collide.
- **Dead Captains are fair game.** Rumours fester as a vendetta, and Dares come due on Return.
- **Which Player started it:** already settled by [Score or no score](04-score-or-no-score.md). Captains never learn the truth; only rare, often-wrong Accusations name a Player.

### Rumour

- **Authoring:** a structured picker. Choose the *source* Captain (who supposedly said it), the *target*, the *Claim* kind, and a subject drawn from the target's real Traits, Fears and Trophies. You can add an **optional line in your own words**. The sim uses only the structured parts. Generated Clash dialogue may quote or mangle the free text, which follows the [tone bible](../tone-bible.md).
- **Five Claim kinds, each pushing a different reaction:**

  | Claim | Pushes the target towards |
  |---|---|
  | Insult (looks, gear, habits) | a Clash |
  | "He's scared of…" (exposes a Fear) | the target mocking the source, which may set off the Fear |
  | "He nicked your…" (theft) | stealing it back (Trophy hooks) |
  | "He fancies your mum" | blind rage |
  | "He's planning a coup" | paranoia and a pre-emptive strike |

- **Outcomes (base odds, shifted by Traits):**
  - **Works (~50%):** the target gets a Grudge against the source.
  - **Wrong orc (~30%):** the Rumour reaches a different Captain. It's biased towards one who shares the relevant feature (a bucket insult finds the orc who really wears a bucket), and otherwise picks at random.
  - **Garbled (~20%):** the sim moves the Claim **up an escalation ladder** (insult → mum → betrayal → coup), and may swap in an absurd subject from a small bank. The garbled version is the canonical Fact. Narration only puts it into words.
- **Trait modifiers:** Gullible targets always believe it. A Compulsive Liar as the source raises the Garble chance. A Hothead target goes straight to a Clash.

### Dare

- **Two kinds, one hand-written bank of ~30–40 dares**, each tagged with the Fears and Traits it plays on:
  - **Stunt dare** (one Captain): "swim the moat", "eat the cursed pie".
  - **Prank dare** (one Captain against another): "nick Snarlbottom's bucket", "sit on the Warlord's throne". The victim gets a Grudge, and a Clash becomes much more likely.
- **Menu:** picking a target shows **3 dares that suit him** (weighted towards his Fears and Traits) plus **"Surprise me"**.
- **Outcomes (base odds, shifted by Fears and Traits):**
  - **Botched (~60%):** a disaster, which can mean injury, a Humiliation or death. Which one is decided under [Failing Upward rules](09-failing-upward-rules.md). Daring a Captain into his own Fear makes this near-certain.
  - **Pulled off (~20%):** unearned glory, an insufferable Captain, and jealous Grudges from others.
  - **Refused (~20%):** he bottles it, gets branded a coward, gains Infamy and is mocked.
- **Trait modifiers:** a Show-off never refuses. A Coward usually does. A Drunkard accepts anything. A Hothead turns a prank into a Clash.

**Effects on the map:**
- [Failing Upward rules](09-failing-upward-rules.md) must define what a botched Dare can do, and how Returning Captains pick up held Rumours and Dares.
- The *Event catalogue* fog gains: the Dare bank (~30–40), the Rumour subject and escalation banks, and reaction events for each Claim kind.
- The *data model* fog gains: pending Meddles with fuse times, and held Meddles on dead Captains.
- [Backing economy](08-backing-economy.md) is simplified: gold no longer pays for Meddles.

## Comments
