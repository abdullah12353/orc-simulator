# Voice test: the main six and the announcer

A trial of ElevenLabs Voice Design ([#19](https://github.com/abdullah12353/orc-simulator/issues/19), findings on branch `research/voice-casting`) before paying for the full cast. The six are the accusers, one per accent, the same six the tone bible calibrates on. You pick the voices by ear; the script designs them, renders every line and puts it in the game.

Everything fits the **free tier** (10k credits a month): about 2.7k credits for all the lines, plus about 250 per Voice Design generation. Free is non-commercial, which is fine for a test.

## 1. Design the voices

1. Sign up at elevenlabs.io (free, no card).
2. Profile → **API keys** → create one. If it asks for permissions, allow **Text to Speech** and **Voices** (write).
3. In the repo root, create `.env.voices` (git-ignored) holding one line: `ELEVENLABS_API_KEY=…`. Don't paste the key anywhere else.
4. Design, then listen to the three previews in `voices/designs/` and save the best:

```powershell
npm run voices:design krug vorgash announcer  # three previews each, about 250 credits a voice
npm run voices:save krug 2                     # save krug-2.mp3 as a voice, write its ID to voice-ids.json
```

The prompts are `DESIGNS` in [`test-cast.ts`](test-cast.ts), all on one template and accent wording, so no accent gets pushed harder than another (the tone bible's swap test). If none of the three lands, change the description and design again. That's the actual test: West Country, Scouse and Indian English aren't in ElevenLabs' docs, so whether a description gets them is unknown. Save soon after designing, as the previews may not be kept for long.

**Slots:** free accounts hold **3 saved voices**. Start with **Krúg, Vorgash and the announcer**. Vorgash's whole Introduction is then real: the stinger, his name shout, "…the Polished", his catchphrase. Design the other four to hear them, but don't save them. Starter ($6, 10 slots) holds all seven at once. Saving a voice again replaces its ID and clears its old takes.

The web UI works too (Voices → Create a voice → Voice Design, with v3): paste a description and preview text from `DESIGNS`, then copy the saved voice's ID (My Voices → ⋯ → Copy voice ID) into [`voice-ids.json`](voice-ids.json).

## 2. Render the lines

Run, in PowerShell from the repo:

```powershell
npm run voices:dry               # what it will render, and the credits
npm run voices                   # every voice with an ID (existing takes are skipped)
npm run voices krug-taunt        # re-render one line
npm run voices:pick krug-shout~2 # use an alternative name shout in the game
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

