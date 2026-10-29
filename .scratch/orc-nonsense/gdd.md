# ORC NONSENSE: Exploratory Game Design Document (draft 1)

Status: **exploratory**. Nothing is built. This document is the destination the wayfinder map ([issue #14](https://github.com/abdullah12353/orc-simulator/issues/14)) is working towards: once every map ticket is resolved, this becomes the locked MVP spec.
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
| Competing vs just stirring | **No score.** No win state or ranking. Players get loud, unranked **Blame** for what their Meddles caused, plus a rap sheet. *(Decided, ticket Score or no score)* |
| Topical humour vs a persistent world | Brexit is a **register**, not a topic: no real people, parties or news. *(Decided, ticket Tone bible)* |
| "All out, no censorship" vs "accents without ethnic caricature" (from the supplementary note) | **Everything goes except punching at identity.** Accents pass the swap test. See [tone-bible.md](./tone-bible.md). *(Decided, ticket Tone bible)* |
| Frequency vs cost | Rules decide every event, the LLM only voices featured ones, and audio is prerecorded. → tickets *Platform limits*, *AI and voice costs*, *Narration tiers* |
| Homage vs originality | Original cast. Krúg is your own invention. No Shadow of War, Tolkien or Mike Brooks names or lines. The daily report is **The Gutter Herald**. *(Decided, ticket Tone bible)* |

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
| **Captain Sponsorship** (Backing) | MVP, **light** | A standing Stake on a Captain. Clash-only edge, pays best on Infamy. See [Backing economy](https://github.com/abdullah12353/orc-simulator/issues/8). |
| **Cascading Disasters** | **Don't build it** | This is an *emergent property* of Grudges + Rumour misfires + Return vendettas. A dedicated cascade system would script what should emerge. |
| **The Herald** (daily report) | MVP, **the stage** | How the mechanics reach you while you're away. Named *The Gutter Herald*. |
| **The Hall of Shame** | MVP-lite, **as a view** | A ranked query over past high-Infamy events and Legendary Captains. No new rules. |

### 4.2 The five strongest (unchanged from draft 0, now confirmed by the supplementary list)

1. **Persistent Grudges**: memory tags between Captain pairs, plus affinity.
2. **The Rumour Mill**: Rumours (and possibly Gifts and Dares) that can misfire.
3. **Backing**: a standing Stake with a small Clash edge, paid out on wins *and* (mostly) Infamy.
4. **The Clash and Captain Introduction**: the shareable set pieces.
5. **Failing Upward**: death → Return with a Humiliation, Infamy, succession by Infamy, Legendary deeds.

### 4.3 Where complexity hides (things to avoid in the MVP)

- Gear and inventory systems (Trophies are flavour tags, not items with stats).
- Positional maps, regions, travel.
- Multi-step quest or cascade scripting.
- Real-time combat or anything that plays out turn by turn.
- Many currencies.

### 4.4 Captain Introduction (new set piece, required)

Shown when a Captain first appears, Returns, or is promoted. Announcer stinger → portrait slam → **the Captain shouts his own name, badly** ("KRRRÚÚÚG!") → the announcer adds the Epithet, deadpan, from a prerecorded bank → one signature line in the Captain's voice. Prerecorded per Captain, so the pronunciation can be tuned by hand. → ticket *The Clash and Introduction cards*.

---

## 5. How the mechanics interact

**Coherence rule:** *the simulation decides what happens, and the narration only decides how it's said.* Every line is grounded in a structured Fact plus Grudge tags.
**Unpredictability:** weighted event selection × Rumour misfires × trait collisions × the Humiliation table.

A worked chain:

1. Mohammed backs **Krúg** (Power 3, Traits *Mummy's Boy* and *Little Fortresser*, Fear of *Water*, catchphrase "exit means exit").
2. Mohammed plants a Rumour: *"Krúg says Grishnack's helmet is a bucket."* It **misfires** onto **Lord Snarlbottom**, a posh orc who really is wearing a bucket.
3. Snarlbottom → Krúg affinity −60, Grudge tag `"called my helmet a bucket"`.
4. The Grudge raises the odds of a Clash. Mid-Clash, a glutton Captain **intervenes** (the wrong saviour) because Krúg was standing near the pies. It makes things worse.
5. Krúg loses and drowns in 30cm of moat. Infamy +25. Mohammed's Backing pays out on Infamy.
6. Snarlbottom takes Krúg's nose ring as a **Trophy**. It shows up in his description and his taunts.
7. Krúg **Returns** as *"Krúg the Damp"*: bandaged, now also afraid of puddles, with a vendetta.
8. The Warlord falls off the throne. Succession by Infamy: **Krúg the Damp is Warlord.** Introduction card: "KRÚÚÚG… THE DAMP."
9. Herald headline: **"DAMP ORC SEIZES POWER — 'EXIT MEANS EXIT,' SAYS NEW WARLORD, REFUSING TO LEAVE THRONE."**

---

## 6. Recommended MVP

### 6.1 The world
One original fortress, around 12 **active** Captains plus a **reserve**, from a fixed, hand-written cast of ~30 (one portrait each), and **Krúg as the founding Captain**, always active but not the starting Warlord. Card, name and voice rules: [Captain card and name generator](https://github.com/abdullah12353/orc-simulator/issues/6). One private world per friend group.

### 6.2 Core loop (async-first, a 3–5 minute visit a few times a day)
1. **Open → the Herald** ("Since You Left"): 5–8 headlines ranked by comedy weight, with the top one introduced by prerecorded announcer stingers (no runtime TTS).
2. **Check your Stable**: Grudges, new Humiliations, Trophies lost and gained.
3. **Meddle**: a handful of Meddles (Rumours first and foremost) and some Backing.
4. **Watch**: while anyone's on, ticks speed up and Clashes and Introductions play live.
5. **Leave.** Consequences land while you're gone, and a push notification fires on anything historic involving your orcs or your Rumours.

**Why it's funny:** you plant chaos, leave, and come back to the newspaper reporting what your chaos did. The punchline is always delayed, attributed to you, and grounded in history.

### 6.3 Reserved for later iterations
Multiple fortresses or regions · seasons and resets · gear and loot systems · player-created Captains · generated portraits · runtime voice cloning · cross-group worlds · Gift and Dare Meddles (if *Meddle verbs* cuts them) · a full Hall of Shame with timelines · shareable video clips · Blame that starts anonymous and is revealed later · recurring Herald awards ("Meddler of the Week") · Accusations with mechanical effects.

---

## 7. Open design questions

These live as tickets on [issue #14](https://github.com/abdullah12353/orc-simulator/issues/14) or in its *Not yet specified* fog. They are not restated here.

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
5. **Audio is almost entirely prerecorded**: per-Captain bark banks keyed by emotion, Introductions, and an announcer stinger set, all generated offline. No runtime TTS in the MVP.
6. **Adaptive tick**: slow when nobody's online, fast when someone is.

---

## 9. Preserved spontaneous ideas

- **Krúg**, the recurring nuisance and founding Captain.
- **Krúg Bootleg**, a badly disguised Return form.
- **Krúg's mum**, an off-screen presence referenced constantly and never seen.
- **Susan**, the Brexit-geezer meme's long-suffering wife, another off-screen gag.
- **Drank too much / fell in a pond**: the Herald's tone in two examples.
- **The stupidest orc ruling the fortress.**
- **Legendary for causing Brexit.**
- **"A day in the life of a Brexit geezer"**: the register for a whole class of Captains. "Exit means exit." "Once you go black, you never go back" (re-grounded onto black pudding, tar or soot, never race).
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
| D6 | Stack: React/TS PWA, Supabase free, Cloudflare, a free LLM (amended by D37), ElevenLabs | **Decided** | Brief, amended by ticket *Narration tiers* |
| D7 | Rules-based sim owns canonical state; LLM only narrates Facts | **Decided** | Brief |
| D8 | Destination: a locked MVP spec; building is a later effort | **Decided** | Grilling Q1 |
| D9 | Async-first loop; live speed-up while someone's on | **Decided** | Grilling Q2 |
| D10 | Backing: small edge, pays out on wins and Infamy | **Decided** | Grilling Q4 |
| D11 | Warlord succession by Infamy, Power as tie-break | **Decided** | Grilling Q5 |
| D12 | Krúg (accent on the u, said "KROOG") is the founding Captain | **Decided** | Grilling Q7 |
| D13 | Mohammed plans alone; no Haris sign-off needed | **Decided** | Grilling Q8 |
| D14 | Cascading Disasters is emergent, not a system | Proposed | §4.1 |
| D15 | Trophies are an effect + tag, not an inventory | Proposed | §4.1 |
| D16 | Hall of Shame is a view over the event log, not a system | **Decided** | §4.1, ticket *Hall of Shame* |
| D17 | Captain Introduction is a required MVP set piece | Proposed | Supplementary note |
| D18 | No win state or ranking; Blame (announced, unranked, follows the whole causal chain, shared, Meddles only) plus a per-Player rap sheet | **Decided** | Ticket *Score or no score* |
| D19 | Gold is fuel, never shown as wealth; Stables may overlap | **Decided** | Ticket *Score or no score* |
| D20 | Accusations: rare, often wrong, mangled pre-rendered Player names, flavour only (no state change) | **Decided** | Ticket *Score or no score* |
| D21 | Everything goes except punching at identity; same rule for hand-written and generated lines | **Decided** | Ticket *Tone bible* |
| D22 | Swap test: accents are voices, never punchlines; written down through word choice only | **Decided** | Ticket *Tone bible* |
| D23 | Full profanity (c-word rare, never in the Herald), no slurs, innuendo but nothing explicit | **Decided** | Ticket *Tone bible* |
| D24 | Brexit is a register, not a topic; no real people | **Decided** | Ticket *Tone bible* |
| D25 | All Captains are male; women only as off-screen gags (Krúg's mum, Susan) | **Decided** | Ticket *Tone bible* |
| D26 | Prerecorded lines hand-written; Clash dialogue and the Herald generated under the tone bible; templated fallbacks | **Decided** | Ticket *Tone bible* |
| D27 | The daily report is The Gutter Herald: clean, deadpan; mocks Meddles, never Players | **Decided** | Ticket *Tone bible* |
| D28 | Fixed, hand-written cast of ~30; portraits one-to-one, with Humiliations and disguises as overlays | **Decided** | Ticket *Captain card* |
| D29 | Card: 2 Traits + 1 Fear, Power 1–10, Infamy, one Epithet, two disguise aliases, unique voice; Grudges live on pairs | **Decided** | Ticket *Captain card* |
| D30 | Six accent archetypes; muffled is a Humiliation overlay; the Brexit geezer is a Trait (Little Fortresser) | **Decided** | Ticket *Captain card* |
| D31 | Names are guttural or compound English, with say-as respellings; Captains shout their own names badly; Epithets come from a prerecorded announcer bank | **Decided** | Ticket *Captain card* |
| D32 | Krúg starts at Power 3, not Warlord, always in the active 12 | **Decided** | Ticket *Captain card* |
| D33 | Gold comes only from a flat daily Stipend (≈10) and payouts; banked to a cap (≈30), overflow lost, no reset | **Decided** | Ticket *Backing economy* |
| D34 | Backing is a standing Stake: withdraw for half back, held through death; who backs whom public, amounts private | **Decided** | Ticket *Backing economy* |
| D35 | Backing edge is flat for each backer (≈+5%, max +10%) and applies to Clashes only; gold never buys odds | **Decided** | Ticket *Backing economy* |
| D36 | Payouts: ≈10% of Stake per win, ≈1% per Infamy point, rounded up; shown only privately, never in the Herald | **Decided** | Ticket *Backing economy* |
| D37 | Narration runs at $0: Cloudflare Workers AI as primary, Groq gpt-oss-120b as fallback, templates as the last resort; the free quota is the cap; model chosen by bake-off | **Decided** | Ticket *Narration tiers* |
| D38 | Tiers: every Clash gets generated dialogue; the Herald is generated on open; notable events are templated; minor changes are silent; no runtime TTS | **Decided** | Ticket *Narration tiers* |
| D39 | Tick every 1 min when watched (Player seen within 5 min), every 5 min otherwise; Worker as clock, Edge Function runs the tick; narration never blocks it | **Decided** | Ticket *Narration tiers* |
| D40 | Any disaster can kill (Clash, botched Dare, accident), about 1–3 deaths a day; every Captain Returns after 2–12 h with an Introduction and an hour's grace from dying | **Decided** | Ticket *Failing Upward* |
| D41 | Every Return brings exactly one Humiliation that fits the death; five categories (bandages, lost bits, disguise, Epithet, new Fear) with their own lifetimes; none touch Power or the odds | **Decided** | Ticket *Failing Upward* |
| D42 | Infamy comes only from stupidity (tiers 1–4 / 5–15 / 15–30; wins 0; the throne +20) and is lifetime; Power only drifts ±1 | **Decided** | Ticket *Failing Upward* |
| D43 | No ranks below Warlord; he falls on any death, Clash loss or botched Dare; the most Infamy in the last 7 days succeeds (amends D11's Infamy to recent Infamy) | **Decided** | Ticket *Failing Upward* |
| D44 | The active 12 stays at 12: a reserve Captain steps in on a death, and a Returner benches the least recently infamous; Krúg is never benched | **Decided** | Ticket *Failing Upward* |
| D45 | Legendary at 150 lifetime Infamy, marked by a Legendary deed; permanent, never retired | **Decided** | Ticket *Failing Upward* |
| D46 | Every event (Clashes and Dares included) is one data template: trigger, cast preconditions, outcome table, effects, 3 line variants, base comedy weight; ~60 templates plus banks in v1, drafted by Claude and struck by Mohammed | **Decided** | Ticket *Event catalogue* |
| D47 | Ambient events fire on ~1 in 3 watched and ~1 in 10 unwatched ticks; reactions chain 3 deep, then fuse 5–30 min; deaths capped at 3 a day; recent templates and pairs halved; Krúg counts double | **Decided** | Ticket *Event catalogue* |
| D48 | Clashes only from Grudges (affinity < −50, ~5% a tick) or forcing Meddles; logistic Power odds plus Backing and Traits; won, defeated or fled; wrong saviour in ~1 in 5; Trophy in ~half of defeats | **Decided** | Ticket *Event catalogue* |
| D49 | Pair affinity −100..+100 drifts to 0 by ~5 a day; Grudge tags are permanent | **Decided** | Ticket *Event catalogue* |
| D50 | Comedy weight is deterministic: base + Infamy/3 + 3 per callback + 2 if Meddle-caused + 2 if Krúg or the Warlord; Legendary deeds rank first | **Decided** | Ticket *Event catalogue* |
| D51 | The Herald is per Player ("Since You Left" since their last visit): lead story + 4–7 headlines + a collapsed list, at most 8 stories; "Stop press" when no new edition is due; last 7 editions browsable | **Decided** | Ticket *Herald* |
| D52 | Only the lead story gets the announcer and auto-plays its set piece; Legendary deeds get a fanfare | **Decided** | Ticket *Herald* |
| D53 | One templated Blame line per Meddle-caused story; at most one Accusation per edition, as a pull quote over the true Blame; the model writes only headlines and bodies | **Decided** | Ticket *Herald* |
| D54 | Private "Your Stable" section for gold and Stakes; pushes only for your Stable or Meddles, at most 3 a day, quiet hours 23:00–08:00, never gold; any story can be clipped | **Decided** | Ticket *Herald* |
| D55 | Hall of Shame: Legends, moments with comedy weight 20+, and Clippings; browsed by Captain, by Player (the rap sheet: 10 heaviest Blame, in time order) or timeline; never ranked; replays without the model; kept forever | **Decided** | Ticket *Hall of Shame* |
