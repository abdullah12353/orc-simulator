# ORC NONSENSE: Exploratory Game Design Document (draft 1)

Status: **exploratory**. Nothing is built. This document is the destination the wayfinder map ([map.md](./map.md)) is working towards: once every map ticket is resolved, this becomes the locked MVP spec.
Vocabulary: [GLOSSARY.md](../../GLOSSARY.md). Decision log: §10 here, plus the map's *Decisions so far*.

Sources: the Mohammed/Haris brainstorm summary (§1), the supplementary creative direction note (§1.5), and first-round grilling answers.

> **North star:** this is not a fantasy combat game. It's a world of spectacularly stupid orcs whose behaviour turns into running jokes among friends. The goal isn't to beat the game. It's to laugh too much.

---

## 1. What the sources say

### 1.1 Decisions from the brainstorm

| # | Decision |
|---|----------|
| T1 | Players **interfere from outside** (e.g. planting rumours) and never control orcs directly. |
| T2 | Random events happen **frequently**, roughly every one to a few minutes, during active sessions. |
| T3 | **Death isn't permanent.** Captains come back disguised, embarrassed or amputated. |
| T4 | **First version stays minimal**: simple graphics, unpredictable events, pub, Brexit and orc banter. |

### 1.2 Serious proposals

Backing captains from a budget · two-portrait voiced clashes · a daily news report · a relationship web (friendships, fallouts, insults) · an accent cast · generated fears and weaknesses · trophies from kills · embarrassing gear.

### 1.3 Memories (what made Shadow of War funny for you)

- **The wrong saviour.** A glutton captain spawning in and saving you. Help arrives, and it's the worst possible guy.
- **The recurring nuisance.** Krúg turning up again and again all over the map.
- **Looks and sound.** Pig-faced ugliness, nose rings, cockney, pub banter.
- **Names.** Guttural, German-English sound: Krúg, Grishnack, "Krúg Bootleg".

### 1.4 Tensions, and how they've been settled

| Tension | Resolution |
|---|---|
| Live (an event every minute) vs away (the daily report) | **Async-first**. The world speeds up while someone is watching, and time away gets compressed into the Herald. *(Decided, Q2)* |
| Money buys odds vs the stupidest orc rules | Backing gives a **small edge** and pays out on **Infamy as well as wins**. *(Decided, Q4)* |
| Competing vs just stirring | **Open.** Explore both a light scoreboard and pure no-score chaos. → ticket *Score or no score* |
| Topical humour vs a persistent world | Brexit-geezer register as a running theme ("exit means exit") rather than news commentary. → ticket *Tone bible* |
| "All out, no censorship" vs "accents without ethnic caricature" (from the supplementary note) | **Open.** The two sources contradict each other, and what the narration model will actually produce also has a bearing. → ticket *Tone bible* |
| Frequency vs cost | Rules decide every event, the LLM only voices featured ones, and audio is prerecorded. → tickets *Platform limits*, *AI and voice costs*, *Narration tiers* |
| Homage vs originality | Original cast. Krúg is your own invention. No Shadow of War, Tolkien or Mike Brooks names or lines. **"Mordor Morning Herald" needs renaming** (Mordor is Tolkien's). |

### 1.5 Supplementary direction (Haris's references and the extended mechanics list)

- **Banter spirit**: in the vein of Mike Brooks' *Da Big Dakka* / *Brutal Kunnin*. Rowdy, crude, argumentative, overconfident, full of misunderstandings. Used as *inspiration only*.
- **Humour must come from personality and situation**, not random joke generation.
- **Dramatic captain introductions and badly pronounced guttural names are essential.** This adds a set piece to the MVP (§4.4).
- **Portraits**: faces mostly hidden by dirty bandages, helmets, masks and odd headgear, with glimpses of unsettling eyes or teeth.

---

## 2. Recurring humour themes

1. **Menace undercut by the mundane.** Intimidating presentation, total stupidity. *(Reinforced by the supplementary note: "central to the experience".)*
2. **Recurrence and callbacks.** The joke isn't Krúg once. It's Krúg *again*.
3. **Failing upward.** The idiot rules, and a disaster makes a legend.
4. **Humiliation that sticks.** Bandages, stumps and disguises stay on the portrait.
5. **The wrong person turns up.** Help and harm both come from the least appropriate orc.
6. **The Brexit geezer.** Pub philosophy, defiant slogans ("exit means exit"), unshakeable confidence in wrong opinions, class accents from the gutter to the manor house.
7. **Insult as affection.** Swearing, petty arguments, fallouts, making up.
8. **Misunderstanding.** Orcs mishear and misread each other, and act on rumours that were never true. *(New, from the Brooks reference: it fits the Rumour Mill exactly.)*
9. **Absurd officialdom.** Newspapers, titles and a Hall of Shame treat idiocy with the gravity of history.

---

## 3. Serious design versus spontaneous jokes

Rule of thumb: **systems for the left column, seed content for the right.**

| Systems | Seed content (data, not mechanics) |
|---|---|
| Outside interference / Rumours | Krúg's mum as a weakness |
| Frequent events, async compression | Krúg drank too much / fell in a pond |
| Death and Return with Humiliation | "Krúg Bootleg" (a disguised Return form) |
| Backing | Legendary for "causing Brexit" |
| Clash and Captain Introduction | Mummy bandages over the eyes *and* mouth (muffled barks) |
| Grudges and Trophies | "Exit means exit" / Brexit-geezer slogans as catchphrases |
| Infamy-based succession | Skull bolted to the armour |
| The Herald | Accent roster |

---

## 4. The mechanics: which reinforce each other, and which add complexity

### 4.1 Mapping the supplementary list

| Supplementary idea | Verdict | Notes |
|---|---|---|
| **Persistent Grudges** | **Core** | The memory every other mechanic writes to and reads from. The Krúg engine. |
| **The Rumour Mill** | **Core** | The main Player verb. Misfires and misunderstandings create emergence. |
| **The Idiot Arena** (Clash) | **Core** | The set piece. Two portraits, barks, 2–4 lines, sometimes an unexpected intervention (the wrong saviour). |
| **The Incompetent Hierarchy** | **Core**, merged with Return | Rank comes from Infamy as much as Power. Accidents and luck promote. |
| **The Return of the Idiot** | **Core**, merged with Hierarchy | One system: *Failing Upward*. |
| **Trophies and Loot** | MVP, **as an effect, not a system** | A Clash effect: it adds a Trophy and a Grudge tag. No inventory. |
| **Captain Sponsorship** (Backing) | MVP, **light** | Stakes for each friend. How much it matters depends on *Score or no score*. |
| **Cascading Disasters** | **Don't build it** | This is an *emergent property* of Grudges + Rumour misfires + Return vendettas. A dedicated cascade system would script what should emerge. |
| **The Herald** (daily report) | MVP, **the stage** | How the mechanics reach you while you're away. Needs an original name. |
| **The Hall of Shame** | MVP-lite, **as a view** | A ranked query over past high-Infamy events and Legendary Captains. No new rules. |

### 4.2 The five strongest (unchanged from draft 0, now confirmed by the supplementary list)

1. **Persistent Grudges**: memory tags between Captain pairs, plus affinity.
2. **The Rumour Mill**: Rumours (and possibly Gifts and Dares) that can misfire.
3. **Backing**: a small edge on odds, paid out on wins *and* Infamy.
4. **The Clash and Captain Introduction**: the shareable set pieces.
5. **Failing Upward**: death → Return with a Humiliation, Infamy, succession by Infamy, Legendary deeds.

### 4.3 Where complexity hides (things to avoid in the MVP)

- Gear and inventory systems (Trophies are flavour tags, not items with stats).
- Positional maps, regions, travel.
- Multi-step quest or cascade scripting.
- Real-time combat or anything that plays out turn by turn.
- Many currencies.

### 4.4 Captain Introduction (new set piece, required)

Shown when a Captain first appears, Returns, or is promoted. Announcer stinger → portrait slam → **the name shouted, badly pronounced** → title / epithet → one signature line in the Captain's voice. Prerecorded per Captain, so the pronunciation can be tuned by hand. → ticket *The Clash and Introduction cards*.

---

## 5. How the mechanics interact

**Coherence rule:** *the simulation decides what happens, and the narration only decides how it's said.* Every line is grounded in a structured Fact plus Grudge tags.
**Unpredictability:** weighted event selection × Rumour misfires × trait collisions × the Humiliation table.

A worked chain:

1. Mohammed backs **Krúg** (Power 3, *Hydrophobic*, *Mummy's Boy*, Brexit-geezer register: "exit means exit").
2. Mohammed plants a Rumour: *"Krúg says Grishnack's helmet is a bucket."* It **misfires** onto **Lady Snarlbottom**, a posh orc who really is wearing a bucket.
3. Snarlbottom → Krúg affinity −60, Grudge tag `"called my helmet a bucket"`.
4. The Grudge raises the odds of a Clash. Mid-Clash, a glutton Captain **intervenes** (the wrong saviour) because Krúg was standing near the pies. It makes things worse.
5. Krúg loses and drowns in 30cm of moat. Infamy +25. Mohammed's Backing pays out on Infamy.
6. Snarlbottom takes Krúg's nose ring as a **Trophy**. It shows up in her description and her taunts.
7. Krúg **Returns** as *"Krúg the Damp"*: bandaged, now also afraid of puddles, with a vendetta.
8. The Warlord falls off the throne. Succession by Infamy: **Krúg the Damp is Warlord.** Introduction card: "KRÚÚÚG… THE DAMP."
9. Herald headline: **"DAMP ORC SEIZES POWER — 'EXIT MEANS EXIT,' SAYS NEW WARLORD, REFUSING TO LEAVE THRONE."**

---

## 6. Recommended MVP

### 6.1 The world
One original fortress, around 12 **active** Captains plus a **reserve** from ~30 portraits, and **Krúg as the founding Captain**. One private world per friend group.

### 6.2 Core loop (async-first, a 3–5 minute visit a few times a day)
1. **Open → the Herald** ("Since You Left"): 5–8 headlines ranked by comedy weight, with the top one announced in a voice.
2. **Check your Stable**: Grudges, new Humiliations, Trophies lost and gained.
3. **Meddle**: a handful of Meddles (Rumours first and foremost) and some Backing.
4. **Watch**: while anyone's on, ticks speed up and Clashes and Introductions play live.
5. **Leave.** Consequences land while you're gone, and a push notification fires on anything historic involving your orcs or your Rumours.

**Why it's funny:** you plant chaos, leave, and come back to the newspaper reporting what your chaos did. The punchline is always delayed, attributed to you, and grounded in history.

### 6.3 Reserved for later iterations
Multiple fortresses or regions · seasons and resets · gear and loot systems · player-created Captains · generated portraits · runtime voice cloning · cross-group worlds · Gift and Dare Meddles (if *Meddle verbs* cuts them) · a full Hall of Shame with timelines · shareable video clips.

---

## 7. Open design questions

These live as tickets on [map.md](./map.md) or in its *Not yet specified* fog. They are not restated here.

---

## 8. Minimal simulation architecture (proposal, pending tickets *Platform limits*, *AI and voice costs* and *Narration tiers*)

```
┌──────────── Cloudflare ────────────┐        ┌──────── Supabase (free) ────────┐
│ Pages: React + TS PWA              │◄──RT──►│ Postgres (canonical state):      │
│ Worker cron: tick → simulate()     │──SQL──►│  world, captains, grudges,       │
│   → Facts → (featured) narrate     │        │  trophies, players, backings,    │
│ Worker daily: build the Herald     │        │  intents, events (append-only)   │
│ Static/R2: portraits, bark bank    │        │ Realtime feed · Auth (invite)    │
└────────────────────────────────────┘        └──────────────────────────────────┘
```

1. **Canonical state changes only inside `simulate()`.** Players write *intents*, and the next tick consumes them.
2. **`simulate(state, intents, seed) → { facts, stateDiff }`**: pure, deterministic TypeScript with a seeded RNG, shared by the Worker and the tests.
3. **Events are data**: templates with preconditions, weights, outcome rules, effects and comedy weight.
4. **Narration sees only Facts** (Fact + both voice cards + top Grudge tags), and falls back to templates on failure. A daily token cap is stored in the DB.
5. **Audio is almost entirely prerecorded**: per-Captain bark banks keyed by emotion, Introductions, and an announcer stinger set, all generated offline. Runtime TTS is limited to at most the top Herald headline.
6. **Adaptive tick**: slow when nobody's online, fast when someone is.

---

## 9. Preserved spontaneous ideas

- **Krúg**, the recurring nuisance and founding Captain.
- **Krúg Bootleg**, a badly disguised Return form.
- **Krúg's mum**, an off-screen presence referenced constantly and never seen.
- **Drank too much / fell in a pond**: the Herald's tone in two examples.
- **The stupidest orc ruling the fortress.**
- **Legendary for causing Brexit.**
- **"A day in the life of a Brexit geezer"**: the register for a whole class of Captains. "Exit means exit." "Once you go black, you never go back."
- **Bloody mummy bandages over eyes and mouth**: muffled barks.
- **The glutton who saves you**: the wrong-saviour intervention.
- **Skull bolted to the armour**: visible Trophies.

---

## 10. Decision log

| ID | Decision | Status | Source |
|----|----------|--------|--------|
| D1 | Players interfere from outside; no direct control | **Decided** | Brainstorm |
| D2 | Frequent events (≈1 to a few min) during active sessions | **Decided** | Brainstorm |
| D3 | Death not permanent; humiliating Return | **Decided** | Brainstorm |
| D4 | Minimal v1 | **Decided** | Brainstorm |
| D5 | Original characters and mechanics; no Shadow of War / Tolkien / Brooks content | **Decided** | Brief |
| D6 | Stack: React/TS PWA, Supabase free, Cloudflare, Haiku 5.5, ElevenLabs | **Decided** (feasibility open) | Brief |
| D7 | Rules-based sim owns canonical state; LLM only narrates Facts | **Decided** | Brief |
| D8 | Destination: a locked MVP spec; building is a later effort | **Decided** | Grilling Q1 |
| D9 | Async-first loop; live speed-up while someone's on | **Decided** | Grilling Q2 |
| D10 | Backing: small edge, pays out on wins and Infamy | **Decided** | Grilling Q4 |
| D11 | Warlord succession by Infamy, Power as tie-break | **Decided** | Grilling Q5 |
| D12 | Krúg (accent on the u, said "KROOG") is the founding Captain | **Decided** | Grilling Q7 |
| D13 | Mohammed plans alone; no Haris sign-off needed | **Decided** | Grilling Q8 |
| D14 | Cascading Disasters is emergent, not a system | Proposed | §4.1 |
| D15 | Trophies are an effect + tag, not an inventory | Proposed | §4.1 |
| D16 | Hall of Shame is a view over the event log, not a system | Proposed | §4.1 |
| D17 | Captain Introduction is a required MVP set piece | Proposed | Supplementary note |
| — | Score or no score | **Open** | Q3 → ticket |
| — | Content boundaries (no censorship vs no ethnic caricature) | **Open** | Q6 → ticket |
