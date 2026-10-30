# Voice test: the main six and the announcer

A trial of ElevenLabs Voice Design ([#19](https://github.com/abdullah12353/orc-simulator/issues/19), findings on branch `research/voice-casting`) before paying for the full cast. The six are the accusers, one per accent, the same six the tone bible calibrates on. You design and save the voices in the web UI, by ear. The script renders every line and puts it in the game.

Everything fits the **free tier** (10k credits a month): about 2.7k credits for all the lines, plus about 250 per Voice Design generation. Free is non-commercial, which is fine for a test.

## 1. Design a voice (web UI)

1. Sign up at elevenlabs.io and open **Voices → Create a voice → Voice Design**.
2. Paste the voice's **description** and **preview text** from below. If it offers a model, pick **v3**. Generate: you get three options.
3. If the accent misses, tweak the description and generate again. That's the actual test. West Country, Scouse and Indian English aren't in ElevenLabs' docs, so whether a description gets them is unknown.
4. Save the best option, copy its **voice ID** (My Voices → the voice → ID), and paste it into [`voice-ids.json`](voice-ids.json).

**Slots:** free accounts hold **3 saved voices**. Start with **Krúg, Vorgash and the announcer**. Vorgash's whole Introduction is then real: the stinger, his name shout, "…the Polished", his catchphrase. Judge the other four by their previews. Starter ($6, 10 slots) holds all seven at once, with no deleting.

## 2. Render the lines

1. ElevenLabs → profile → **API keys** → create one with Text to Speech access.
2. In the repo root, create `.env.voices` (git-ignored) holding one line: `ELEVENLABS_API_KEY=…`. Don't paste the key anywhere else.
3. Run, in PowerShell from the repo:

```powershell
npm run voices -- --dry                # what it will render, and the credits
npm run voices                         # every voice with an ID (existing takes are skipped)
npm run voices -- krug-taunt           # re-render one line
npm run voices -- --pick krug-shout~2  # use an alternative name shout in the game
```

- The masters land in `voices/takes/` (git-ignored). The main take of each line is trimmed, loudness-matched and put in the game, replacing its placeholder.
- The lines are in [`test-cast.ts`](test-cast.ts). Edit any line, then re-render it by name.
- Each Captain has three spellings of his name shout (`shout`, `shout~2`, `shout~3`), because how the model reads stretched letters is untested.
- `npm run deploy:web` rebuilds the site and redeploys it to Cloudflare Pages with the new sounds.
- Muffled (mouth bandage) needs nothing: the game filters his own voice.

## 3. What to listen for

- **The accent lands**, and it's the right one, not generic British.
- **He sounds like a big orc**, not a bloke reading lines.
- **The name shouts:** which spelling sounds best, and whether any come out spelled letter by letter.
- **The swap audit:** `swap-1` and `swap-2` are the same two lines in all six voices. If one voice sounds like a caricature next to the others, redesign it.
- **The announcer** is flat and deadpan, and an Epithet lands after the name shout.

---

## The voices

Every description uses the same template and accent wording, so no accent gets pushed harder than another (the tone bible's swap test).

### Krúg (cockney): Mummy's Boy, Little Fortresser

**Description**

```text
Native British English with a thick working-class East London cockney accent. Male, 40s. Studio-quality recording. A boastful orc bruiser who is a mummy's boy. Loud, defensive, overconfident. Deep, gravelly, rough throat like a huge brute; fast, punchy pub-banter delivery.
```

**Preview text**

```text
Exit means exit. I ain't leaving the throne, I ain't leaving the pub, I ain't leaving nothing. Water? Don't talk to me about water, you absolute melt. My mum says I'm the hardest orc in the fortress. Come 'ere then, you bucket-headed muppet!
```

### Lord Snarlbottom (posh RP): Snob, Vain

**Description**

```text
Native British English with a thick upper-class received pronunciation accent. Male, 50s. Studio-quality recording. A vain, snobbish orc lord. Cruel, smug, bored. Deep, gravelly, rough throat like a huge brute; slow, drawling, superior delivery.
```

**Preview text**

```text
One does not wear a bucket. One wears a heritage helm, you ghastly little turd. Frightfully sorry, I appear to have stabbed you. Do send the invoice to Mummy. Peasants, the lot of you. I shall have you flogged, old boy. Not today, I've got polo.
```

### Old Mudgut (West Country): Glutton, Little Fortresser

**Description**

```text
Native British English with a thick rural West Country Somerset accent. Male, 60s. Studio-quality recording. A greedy old orc glutton. Contented, stubborn, grumbling. Deep, gravelly, rough throat like a huge brute; slow, wet, rumbling delivery.
```

**Preview text**

```text
I've ate worse than you for breakfast. I've ate a door. That's not a moat, boy, that's a paddling pool for pissy little cowards. He started it. I finished it. Then I ate the bastard. Now, who's had my dinner?
```

### Skagrot (Scouse): Hothead, Superstitious

**Description**

```text
Native British English with a thick Liverpool Scouse accent. Male, 30s. Studio-quality recording. A hot-headed, superstitious orc scrapper. Twitchy, cocky, indignant. Deep, gravelly, rough throat like a huge brute; quick, rattling, excitable delivery.
```

**Preview text**

```text
Swear down, there was a dragon. It was a goose. But it was a big goose. I'm not arsed, lad. I'm just gonna nut this wall till it says sorry. Stabbed meself in the arse. Still sound, that. Proper sound.
```

### Grizzock (Glaswegian): Hothead, Little Fortresser

**Description**

```text
Native British English with a thick Glasgow Scottish accent. Male, 40s. Studio-quality recording. A furious orc brawler who will fight anything. Aggressive, proud, wound-up. Deep, gravelly, rough throat like a huge brute; fast, hard, clipped delivery.
```

**Preview text**

```text
I'll take yous all on. One at a time. Starting with that wall, ya bastard. Whit d'you mean it's a bucket? It's a helmet, ya absolute fanny. Ma head's fine. It's ma pride that's deid.
```

### Vorgash the Polished (Indian English): Vain, Show-off

**Description**

```text
Native English with a thick Indian English accent. Male, 40s. Studio-quality recording. A vain orc show-off who polishes his tusks. Smug, theatrical, touchy. Deep, gravelly, rough throat like a huge brute; bright, fast, self-admiring delivery.
```

**Preview text**

```text
Look at these tusks. Polished. Every morning. You cannot buy this quality, you crusty bellend. I have never lost a fight. I have only temporarily stopped winning. Shut your face, you mouldy-arsed turnip.
```

### The announcer

**Description**

```text
Native British English with a received pronunciation accent. Male, 50s. Broadcast-quality recording. A deadpan boxing ring announcer. Dry, flat, unimpressed. Slow, measured, every word weighted, with long pauses.
```

**Preview text**

```text
Ladies and gentlemen… and orcs. Introducing… the Polished. Extra. Extra. Orc falls in pond, claims pond started it. Krúg… has been defeated… by a bucket. Again.
```
