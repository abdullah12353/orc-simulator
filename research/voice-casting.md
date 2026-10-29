# Voice casting (ElevenLabs Voice Design, one Starter month)

Ticket: [Voice casting #19](https://github.com/abdullah12353/orc-simulator/issues/19). Builds on [AI and voice costs #3](https://github.com/abdullah12353/orc-simulator/issues/3) (branch `research/ai-and-voice-costs`), [Captain card and name generator #6](https://github.com/abdullah12353/orc-simulator/issues/6) and [Narration tiers and tick budget #11](https://github.com/abdullah12353/orc-simulator/issues/11).
Researched: 2026-10-29. Every source below was **accessed on 2026-10-29**. Where a page shows its own date, it's given.
Sources are ElevenLabs official docs, pricing pages, help-center articles, policy pages and the official blog only. Anything that is my reading rather than the source's words is marked **INFERENCE**. Anything the sources don't settle is marked **UNCERTAIN**.

Scope reminder: there's **no runtime TTS** (#11). Everything below is rendered once, downloaded and replayed from our own storage.

**TL;DR**

- **Voice count:** 30 Captains plus 1 announcer = **31 designed voices**. Starter has **10 custom voice slots**, so voices have to be designed in **waves**: render a voice's lines, download them, delete the voice, and design the next one. Deleting can't be undone, so store each voice's recipe (description, model, seed, preview text). Voice Design is documented as reproducible from the same seed and inputs.
- **Accents:** the docs only show generic British, Irish and Scottish examples. There's an `[Indian English]` tag. **Cockney, RP, West Country, Scouse and Glaswegian are not documented** and need a prompt prototype. Do that prompt R&D on the **Free tier** (10k credits, which include Voice Design) before paying.
- **Muffled:** use a **post-processing low-pass filter on the Captain's own renders**. That costs 0 characters and no extra slot, and it can only ever sound like him. A Voice Design "muffled" prompt makes a different voice, and a Remix costs a slot and can drift from his identity.
- **Announcer:** one designed voice with a dry, flat, deadpan description. It says ~40 Epithets plus every name and alias *correctly*, so it needs a pronunciation dictionary (alias rules, or IPA phoneme rules on v4/v3).
- **Shouted names:** write the stretched respelling straight into the text ("KRRROOOOG!") with `[shouts]`. The docs back capitals and stretched letters for prosody. Whether the rolled R works is **UNCERTAIN** and needs prototyping.
- **Budget:** a **lean** cast (12 barks per Captain) needs about **48k characters** including retakes and previews. The **full** cast (20 barks per Captain) needs about **96k**.
- **Verdict:** one Starter month **fits the lean cast only under the API reading** (75k characters). It fits **nothing** under the 30k-credit reading, and the docs still disagree on which applies. **Plan B:** Starter plus a Pay As You Go top-up, or one month of Creator (275k characters and 30 slots, which also removes most of the slot juggling).
- **New risk:** mangled Player names have to be rendered in **each accusing Captain's voice**. A friend who joins after the build month needs a re-render in voices that have already been deleted.

---

## 1. Plan facts that bound the problem

| Fact | Source |
|---|---|
| Starter: **30k credits/month**, **10 custom voice slots**, commercial licence, Instant Voice Cloning. Free: 10k credits, 3 slots, Voice Design included. | [Pricing](https://elevenlabs.io/pricing) |
| Starter price: the card shows "$1 per month" next to "$6 First month 83% off", and a top banner says "Ends September 30" with the countdown at zero. **UNCERTAIN:** the promo looks stale. Budget at **$6** and take the $1 if checkout offers it. | same |
| Starter via API: **75,000 characters** on v4, v3 and v2 Multilingual ($0.08/1K), or **150,000** on v4 Turbo, v3 Conversational and Flash/Turbo ($0.04/1K). "API usage is billed in US dollars, not credits." Voice changer: 50 included minutes. Sound effects: 150 included generations. | [API pricing](https://elevenlabs.io/pricing/api) |
| "Credits can be used across our platform. The number of credits used depends on your plan, whether you're generating via the website or API, the product you're using, and the model." | [Billing](https://elevenlabs.io/docs/overview/administration/billing) |
| **UNCERTAIN (carried over from #3, still unresolved):** 30k credits (plans page) and 75k API characters (API page) for the same plan. The billing doc doesn't say whether they're one balance. | Pricing, API pricing, Billing |
| Pay As You Go: "Prepay for usage in advance, with or without a paid subscription". PAYG credits "last for 12 months". Usage-based overage "is not available on new self-serve subscriptions". | [Billing](https://elevenlabs.io/docs/overview/administration/billing) |
| Rollover: "Unused credits roll over for up to two months — up to 2× your monthly quota", but only while the subscription stays active. On cancel or downgrade, "any unused paid credits will expire". | [Pricing FAQ](https://elevenlabs.io/pricing), [Billing](https://elevenlabs.io/docs/overview/administration/billing) |
| Slots: Free 3, Starter 10, Creator 30, Pro 160. To free a slot, delete the voice in My Voices (it "cannot be undone") or upgrade. Library and Default voices don't use slots. | [Help: voice slots per tier](https://elevenlabs.io/docs/help-center/account/general/how-many-voice-slots-do-i-get-per-tier-and-how-can-i-increase-it), [Help: delete voices](https://elevenlabs.io/docs/help-center/product/voices/my-voices/how-do-i-delete-voices-from-my-voices) |
| On downgrade, voices aren't deleted, but you can only use as many as the new plan allows. (This article is old and covers cloned voices.) | [Help: cloned voices on downgrade](https://help.elevenlabs.io/hc/en-us/articles/13416174206481-What-happens-to-my-cloned-voices-when-I-downgrade-the-tier) |
| Output rights: "you retain all rights in and to your Output" (§4(c)(ii)). "You are responsible for exporting any Content you wish to retain before your access to a Service ends" (§14). Free users "may only use the Services for non-commercial purposes" (§1(c)(i)). | [Terms of Use, last updated 09 Oct 2026](https://elevenlabs.io/terms-of-use) |
| Output formats: the default is `mp3_44100_128`. "MP3 with 192kbps bitrate requires … Creator tier or above". 44.1 kHz PCM/WAV "requires … Pro tier or above". | [API: Text to Speech convert](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) |
| Website: "two free regenerations in Text to Speech via the website" if the text, voice and model are unchanged and the first generation is under two hours old. "They are not available via the API." The website offers MP3 128/192/256, WAV, M4A and FLAC downloads from history. | [Text to Speech product guide](https://elevenlabs.io/docs/eleven-creative/playground/text-to-speech) |
| Per-generation limits: v4 10,000 characters, v3 5,000. | same |

**INFERENCE:** 128 kbps MP3 at 44.1 kHz is plenty for barks played in a browser, so the API's format limits don't matter. The website's free regenerations are the cheapest way to do retakes, but they spend from the website credit side, and whether that side is the 30k pool is the open question above.

---

## 2. About 30 voices across six accent archetypes

### 2.1 What Voice Design documents

| Fact | Source |
|---|---|
| "When you hit generate, we'll generate three voice options for you." "The only charge for using voice design is the number of credits to generate your preview text", charged once per generation. Saving one option "will take up one of your voice slots". | [Voice Design](https://elevenlabs.io/docs/eleven-creative/voices/voice-design) |
| Prompt template: "Native <Language>. <Gender>, <Age range>. <Quality level>.", then a 2–5 word persona, 2–3 emotion adjectives, and 1–2 sentences on timbre, pacing and delivery. Put the language and regional variant in the first sentence. "Thick" gives a stronger accent than "strong". Avoid "foreign" and "exotic". Don't write "accent" when you mean intonation. | same |
| The only accent examples on the page are a "thick British accent" (twice), a "crisp British accent", a "proper thick British accent" (an elf), a "soft Irish lilt" and a "heavy Eastern European accent". There's **no** London, Scottish or Indian example. | same |
| Preview text should match the description. "Longer preview texts tend to produce more stable and expressive results." | same |
| API: preview "text length has to be between 100 and 1000". `model_id` is `eleven_multilingual_ttv_v2` (default) or `eleven_ttv_v3`. `seed`: "Same seed with same inputs produces same voice." `guidance_scale` defaults to 5. `loudness` 0 ≈ −24 LUFS. Save a voice by passing the preview's `generated_voice_id` to `/v1/text-to-voice`. | [API: Design a voice](https://elevenlabs.io/docs/api-reference/text-to-voice/design) |
| Designed voices work with "Eleven v4" and earlier, including v3, and support audio tags. | [Voice Design](https://elevenlabs.io/docs/eleven-creative/voices/voice-design) |
| v3/v4 accent tags: the list includes `[British accent]`, `[Scottish accent]` and `[Indian English]`. "The source voice you use will impact on the quality of the accent defined by an Audio Tag." Experimental tags "may be less consistent across different voices". | [Blog: v3 audio tags and accents, last updated 30 Sep 2026](https://elevenlabs.io/blog/eleven-v3-audio-tags-emulating-accents-with-precision), [TTS best practices](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices) |

### 2.2 Per archetype

| Archetype | Documented? | Approach (INFERENCE) |
|---|---|---|
| Cockney | **No.** Only a generic "thick British accent". | "Native English, thick working-class East London cockney accent. Male, 40s. Gravelly, too loud…" Prototype it. |
| Posh RP | **Partly.** "Crisp British accent" is the closest. | "Native British English, received pronunciation, upper-class…" This is likely the easiest one. |
| West Country | **No.** | "Thick rural West Country (Somerset) accent…" Prototype it. This is the most likely to fall back to generic British (**UNCERTAIN**). |
| Scouse | **No.** | "Thick Liverpool Scouse accent…" Prototype it. |
| Glaswegian | **Partly.** `[Scottish accent]` exists as a tag. | Name Glasgow in the description. A generic Scottish voice is an acceptable fallback. |
| Indian English | **Partly.** `[Indian English]` exists as a tag. | Bake the accent into the description rather than the tag. Timbre, age, class and Trait persona only, never an occupation (see §7). |

**Recommendation (INFERENCE):**
- **Put the accent in the Voice Design description**, not in per-line tags, so every line from a voice is consistent. Keep tags for delivery only (`[shouts]`, `[laughs]`).
- **Do the prompt R&D on the Free tier first.** Free includes Voice Design and 10k credits, which is about 60 preview generations at ~150 characters each. Previews are only for listening, so the non-commercial rule doesn't bite. Record each winning prompt and seed, then re-run it on Starter with the same seed and inputs to get the same voice. Each Captain then costs one preview generation on Starter, not three or four.
- **UNCERTAIN:** the reproducibility claim is documented for the API `seed` parameter. Whether it holds across the Free → Starter account change and across model updates is untested. If it fails, budget 2 generations per voice on Starter, which §6 already does for the full budget.
- **Five voices per accent:** separate them by age, timbre, pace and Trait persona (Glutton → wet and slow, Show-off → bright and fast).

### 2.3 Ten slots for 31 voices

- **Waves (INFERENCE):** the announcer keeps one slot for the whole month, and Captains go 9 at a time (9 + 9 + 9 + 3). For each wave: design, save, render **all** of the wave's lines, download the masters, then delete the voices. Downgrading doesn't delete voices, but anything over the slot limit becomes unusable, so the waves have to be finished inside the month anyway.
- **The recipe goes in the repo:** for every voice, store the description, `model_id`, `seed`, `guidance_scale`, `loudness` and preview text. That's the only way back to a deleted voice.
- **Creator (30 slots)** would hold 30 of the 31 at once, so it only needs one deletion.

---

## 3. Muffled: a filter, not a prompt

Requirement (#6, #9): any Captain can get mouth bandages, which muffle **his own** voice. The muffled voice goes away when the bandage heals after about 2 days. The tone bible writes muffled lines as "MMF HRRMMF FFKN MMF!" with a subtitled translation.

| Option | What the docs say | Verdict |
|---|---|---|
| **Voice Design prompt** ("Muffled and distant, like on an old tape recorder") | The phrase is the page's own lo-fi example. FX words "can negatively affect output quality". | **No.** It makes a *new* voice, not his. ([Voice Design](https://elevenlabs.io/docs/eleven-creative/voices/voice-design)) |
| **Voice Remix** with "audio quality" changed | Remix can "Change gender, accent, speaking style, pacing, and audio quality". It's billed on the test script and "creates a new voice variant". Strength runs from Low ("maintain most of the original voice characteristics") to Max ("changing the voice entirely"). | **Not worth it.** It needs a second slot per Captain, costs preview characters, and the identity can drift. The docs don't say whether a remix uses a slot (**UNCERTAIN**), but saving one makes it a custom voice. ([Voice remixing](https://elevenlabs.io/docs/overview/capabilities/voice-remixing)) |
| **Audio tag** `[muffled]` | Not in any tag list. | **Doesn't exist.** ([Best practices](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices), [Audio tags list, updated 15 Oct 2026](https://elevenlabs.io/blog/elevenlabs-audio-tags-list)) |
| **Voice Changer** (speech-to-speech): record a human muffling through a hand and convert it to his voice | It "captures whispers, laughs, cries, accents, and subtle emotional cues". Billed at "1,000 characters per minute". Up to 5 minutes per segment. Starter API includes 50 minutes. | **A good backup** for bespoke gibberish lines, at about 50 characters per 3-second line. Needs his voice still in a slot. ([Voice changer](https://elevenlabs.io/docs/overview/capabilities/voice-changer), [API pricing](https://elevenlabs.io/pricing/api)) |
| **Post-processing filter on his existing renders** (low-pass, a little gain and saturation, applied at build time or with a Web Audio `BiquadFilterNode` at playback) | Not an ElevenLabs feature. | **Recommended (INFERENCE).** It costs 0 characters and no slots, it's guaranteed to be his voice, and it can be switched off when the bandage heals. The "MMF…" text is just the subtitle over his muffled real bark. |

**INFERENCE:** if muffled barks must be *different* lines from his normal ones, render the plain-English versions in his voice during his wave and muffle them with the filter. Typing "MMF HRRMMF" straight into TTS is untested, and it's likely to be read out letter by letter or get normalised (**UNCERTAIN**).

---

## 4. The deadpan announcer and the Epithet bank

- **Voice:** a single designed voice, kept in its slot all month. Use the documented template: "Native British English, received pronunciation. Male, 50s. Broadcast quality. Deadpan boxing MC; dry, flat, unimpressed. Slow, measured, every word weighted." There's no `[deadpan]` or `[monotone]` tag. The nearest documented manner tag is "[like a sports commentator, speeding up]" ([Audio tags list](https://elevenlabs.io/blog/elevenlabs-audio-tags-list)), so the flatness has to come from the description (**INFERENCE**). Quality words are fine here because the voice isn't niche ([Voice Design](https://elevenlabs.io/docs/eleven-creative/voices/voice-design)).
- **Pauses:** "Eleven v4 and Eleven v3 do not support SSML break tags". Use punctuation, ellipses and text structure ([Best practices](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices)). "…the Damp." gets the dramatic beat from the ellipsis.
- **What he records:**
  - ~40 Epithets as standalone clips.
  - Every Captain name and alias, said **correctly**, for outcome lines ("KRÚG… HAS BEEN DEFEATED… BY A BUCKET").
  - Stingers.
  - Outcome and verdict fragments.
- **Stitching (INFERENCE):** a Captain's name shout and the announcer's Epithet are two separate files joined at playback (#6, #10). Render every Epithet with the same lead-in ellipsis and the same `loudness` so any pair joins cleanly. Normalise loudness across the bank afterwards.

---

## 5. Pronunciation control

| Mechanism | Models | Source |
|---|---|---|
| **Pronunciation dictionary phoneme rules** (IPA or CMU) | "only work with eleven_v4, eleven_v4_turbo, eleven_flash_v2 and eleven_v3". Other models skip them. | [Using pronunciation dictionaries](https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/pronunciation-dictionaries) |
| **Alias rules** (replace a string before synthesis) | The fallback for models without phonemes. The page doesn't explicitly say they work on every model. | same |
| Dictionary rules are case sensitive: "PLS files are case sensitive", so "tomato" and "Tomato" need separate entries. Up to **3 dictionaries per request** ("You may have up to 3 locators per request"), applied in order. | API | same, and [API: TTS convert](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) |
| **Inline IPA:** "Eleven v4 understands IPA symbols when they are wrapped in forward slashes". v3 "includes native support for International Phonetic Alphabet (IPA)". | v4, v3 | [Best practices](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices), [Help: force a pronunciation](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/how-can-i-force-a-certain-pronunciation-of-a-word-or-name) |
| **Respelling:** "capital letters, dashes, apostrophes" ("trapezIi"). "Capitalization increases emphasis" (v4). | any | same |
| **Shouting and stretching:** `[shouts]` ("[shouts]Everybody evacuate the building, now!"), `[drawn out]` ("[drawn out]Nooo way."). "Add ellipses, dashes, or capitals to shape the prosody of a line." A voice that has never shouted "should still be able to follow `[shouting]`", but this "might be less reliable". | v3, v4 | [Audio tags list](https://elevenlabs.io/blog/elevenlabs-audio-tags-list), [Best practices](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices) |
| **Text normalisation** is "enabled by default for all TTS models". | all | [Best practices](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices) |

**Recommendation (INFERENCE):**
- **Announcer (correct names):** keep one PLS dictionary of every name, alias and Epithet with an **alias rule** from the display spelling to the say-as respelling (Krúg → Kroog). Add both capitalisations, and both the diacritic and plain spellings. Add IPA phoneme rules only where an alias doesn't land. Since there's no runtime TTS, the dictionary is just a build tool, but it keeps the announcer consistent across 90 names.
- **Captain shouts (wrong on purpose):** don't use the dictionary. Write the shout as **literal text in the say-as respelling, stretched and capitalised**: `[shouts] KRRROOOOOG!`. Don't feed the diacritic display spelling ("KRRRÚÚÚG") to TTS, because how the model reads "Ú" is **UNCERTAIN**. A tripled consonant might be rolled, stuttered or spelled out (**UNCERTAIN**). Prototype 3–4 variants per name with the website's free regenerations and keep the best. If none lands, the Voice Changer backup in §3 (a human shouts it, then it's converted to his voice) covers it.

---

## 6. Worked character budget for the full prerender

**Assumptions:**
- About 6 characters per word, including spaces and punctuation. One audio tag (~9 characters) per line is included in each line length.
- **P = 6 Players.** This is an assumption, since the friend group's size isn't fixed. Each mangled-name line scales with P.
- Accusation lines are stitched: a line with a gap, plus the mangled name as its own clip, rendered **in the accusing Captain's voice** (#4: "a small fixed set of orc pronunciations … pre-rendered once as audio").
- **Full:** 20 barks per Captain (#3's figure), 2 mangled forms per Player, and 3 Voice Design generations per voice at about 200 characters.
- **Lean:** 12 barks per Captain (each Clash plays one slam-in bark per Captain, #10), 1 mangled form per Player, and 2 generations per voice at about 120 characters, after Free-tier R&D.

### 6.1 Per Captain (×30)

| Item | Full | Lean |
|---|---|---|
| Name shout | 1 × 25 = 25 | 25 |
| Two disguise-alias shouts | 2 × 30 = 60 | 60 |
| Introduction signature line (catchphrase) | 1 × 70 = 70 | 70 |
| Barks, keyed by emotion, including "OI!" | 20 × 50 = 1,000 | 12 × 45 = 540 |
| Accusation lines (with a name gap) | 2 × 60 = 120 | 1 × 60 = 60 |
| Mangled Player names | 6 × 2 × 20 = 240 | 6 × 1 × 20 = 120 |
| Muffled variants | 0 (filter, §3) | 0 |
| **Per Captain** | **1,515** | **875** |
| **× 30 Captains** | **45,450** | **26,250** |

### 6.2 Announcer

| Item | Full | Lean |
|---|---|---|
| Epithets | 40 × 20 = 800 | 800 |
| Names and aliases, said correctly (30 + 60) | 90 × 15 = 1,350 | 1,350 |
| Stingers (Introduction openers, Herald top-headline intros) | 30 × 60 = 1,800 | 20 × 60 = 1,200 |
| Outcome and verdict fragments ("HAS BEEN DEFEATED… BY A") | 40 × 50 = 2,000 | 25 × 50 = 1,250 |
| **Announcer** | **5,950** | **4,600** |

### 6.3 Totals

| Line | Full | Lean |
|---|---|---|
| Net renders (§6.1 + §6.2) | 51,400 | 30,850 |
| Retakes through the API (×1.5 full, ×1.3 lean) | +25,700 | +9,255 |
| Voice Design previews (31 voices) | 31 × 3 × 200 = 18,600 | 31 × 2 × 120 = 7,440 |
| **Total characters** | **≈ 95,700** | **≈ 47,550** |
| Cost at $0.08/1K (v4/v3) | ≈ $7.66 | ≈ $3.80 |
| Free-tier R&D before subscribing (not counted) | — | ≤ 10,000 Free credits |

**Fit against one Starter month:**

| Reading of the Starter quota | Full (≈ 96k) | Lean (≈ 48k) |
|---|---|---|
| **75k API characters** (API pricing page) | **No**, about 21k over | **Yes**, about 27k spare |
| **30k credits** (plans page) | **No** | **No**, about 18k over |
| 150k on v4 Turbo / Flash ($0.04/1K) | Yes | Yes. But Turbo trades expressiveness for speed, and shouting and accent quality are untested (**UNCERTAIN**). Not recommended for the cast. |

**Sensitivity:**
- **Barks dominate.** Every 1 bark per Captain adds about 1,500–2,000 characters including retakes. Every extra Player adds about 800 characters in the lean case (30 Captains × 20 × 1.3).
- **Website retakes:** doing retakes as website free regenerations instead of API calls removes the retake line entirely: full ≈ 70k, lean ≈ 38k. But that only helps if the website and API draw from the 75k-equivalent pool (**UNCERTAIN**, §1).

---

## 7. The tone bible's swap test

The swap test is a script test: "If swapping the accent kills the joke, the joke is cut." It applies to written lines, so the voices themselves can't fail it directly. But a voice *can* smuggle the accent in as the punchline through its delivery or its persona. The ElevenLabs side:

- **Policy:** the [Prohibited Use Policy (last updated 09 Oct 2026)](https://elevenlabs.io/use-policy) has no profanity rule and no rule on accents or dialect. It prohibits "Hateful or discriminatory attacks against individuals or groups based on protected characteristics" and impersonating "any living individual without their explicit and informed consent". It has no fiction or satire carve-out: "We review potential violations in context, including the purpose of the content". The sweary barks are fine. Designed voices avoid the impersonation clause entirely, because no friend's real voice is used.
- **Prompting:** the Voice Design page warns against vague terms like "foreign" and "exotic" ([Voice Design](https://elevenlabs.io/docs/eleven-creative/voices/voice-design)).

**Protocol for passing (INFERENCE):**
1. **Descriptions follow one template for all six accents:** accent, age, timbre, class, and a persona taken from the Captain's **Traits**. Never an occupation or ethnic type (no call-centre, shopkeeper or guru). The tone bible already bans these for scripts, and this extends the rule to the voice prompt.
2. **The same delivery range for every accent.** Indian English gets the same "thick" or "natural" strength wording as Scouse. No sing-song or exaggeration direction that isn't given to the others.
3. **Swap audit during prototyping:** render the same 3 neutral tone-bible lines in one voice from each archetype, plus 3 of each Captain's own lines in a voice of a *different* accent. If a line is only funny in its own accent, cut the line. If a voice sounds like a caricature next to the others, redesign it.
4. **No phonetic accent respelling in the text** (tone bible §3). Respelling is only used for names (§5).

**Verdict:** the voices can pass by construction. Nothing in ElevenLabs' docs or policy blocks it. Whether a designed Indian-English voice sounds natural rather than parodic is **UNCERTAIN** until it's heard, so make it part of the Free-tier R&D wave.

---

## 8. Verdict and plan B

**Can one Starter month do it?** Only the **lean** cast (≈ 48k characters), only if the **75k API-character** figure is the real one, and only with **wave-based slot juggling** (10 slots for 31 voices). The **full** cast (≈ 96k characters) does not fit under either reading.

**Plan A (INFERENCE):**
1. **Free tier first:** design one voice per archetype plus the announcer, run the swap audit, and prototype name shouts. Record each voice's recipe.
2. **Subscribe to Starter.** Check the dashboard on day 1 to see whether the quota reads 30k or 75k.
3. **Render in waves:** the announcer for the whole month, then Captains 9 at a time, everything through the API at `mp3_44100_128`, with masters downloaded to R2 straight away.
4. **Muffled** is a filter, at 0 characters.
5. **Cancel** before renewal (unused credits expire anyway).

**Plan B, in order of preference:**
1. **Starter plus a PAYG top-up** for the overflow. PAYG works "with or without a paid subscription" and lasts 12 months ([Billing](https://elevenlabs.io/docs/overview/administration/billing)). At the API page's $0.08/1K, the full cast's ~21k overflow costs about $1.70. **UNCERTAIN:** the billing page doesn't give the PAYG unit price and points to the pricing page.
2. **One month of Creator** ($22; 275k API characters; 30 slots). It fits the full cast with room to spare, and it cuts the slot juggling down to one deletion. This is also the answer if the dashboard shows 30k on day 1.
3. **Two Starter months** ($12). The second month's quota plus rollover covers the full cast, and the waves are spread over two months.

**What to settle next (feeds the cast-writing work):**
- **Fix bark-bank size and P** (the number of Players), because they're the two numbers that move the budget.
- **Late joiners:** mangled names for a Player who joins after the build month need either a top-up render in the Captains' (deleted, then re-created by seed) voices, or a rule that only a few Captains ever make Accusations. **INFERENCE:** limit Accusations to about 6 "accuser" Captains with the strongest Grudge traits. That cuts mangled-name rendering by about 80% and makes late joiners cheap.
- **UNCERTAIN, to measure on day 1:** whether the quota is 30k or 75k, whether seed reproduction works across accounts, how shouted respellings render, and how the West Country, Scouse and Indian-English voices sound.
