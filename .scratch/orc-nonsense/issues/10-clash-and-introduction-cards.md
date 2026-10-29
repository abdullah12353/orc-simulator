# Clash and Introduction cards

Type: prototype
Status: resolved
Assignee: Mohammed
Blocked by: 05, 06

## Question

What do a Clash and a Captain Introduction look, sound and feel like, second by second?

Build a rough, clickable mockup with static portraits, placeholder audio and hand-written lines, then react to it. Settle the length, number of lines, when barks play, how a wrong-saviour intervention appears, how the outcome and Trophy are revealed, and what the shareable card looks like.

## Answer

Mohammed handed this one over: "decide what is best using what makes us laugh". So every pick below is judged on which version got the bigger laugh in the prototype, and the parts are mixed rather than one variant taken whole.

**The stage is A (Fight Night) for both Introductions and Clashes.** Full screen, two portraits slammed in, stamp, flying Trophy. Pompous fight-night staging around two idiots is the joke itself, the same way the Herald's gravity is, and it gives prerecorded barks and stingers room to land. B's chat panels looked like a messaging app, and C's self-building article read as information rather than spectacle, so it's kept for the Herald, where it belongs.

**Pacing: auto-play, tap to skip ahead.** Comic timing is the director's job, not the viewer's. The beats play on a fixed rhythm (pause, slam, line, pause, punchline). Tapping skips to the next beat, never pauses it. Replays from the Herald play the same way.

**Length: about 15 seconds and 3 lines for a Clash.** Opening jab, comeback, then the loser's last word. A wrong saviour adds one line and about 4 seconds. The generated 2–4 lines from [Narration tiers and tick budget](11-narration-tiers-and-tick-budget.md) are capped at 3 (4 with a saviour). An Introduction runs about 6–8 seconds: stinger, the Captain shouting his own name badly, the announcer's Epithet, one catchphrase.

**Sound per beat.** The stinger opens. Each Captain gets one prerecorded bark (a grunt or catchphrase from his bank) when his portrait slams in. Generated lines are subtitles only, because there's no runtime TTS. The announcer gets the outcome line ("KRÚG… HAS BEEN DEFEATED… BY A BUCKET").

**The wrong saviour crashes in like B's yellow panel.** It's a hard interruption: the screen judders, a third portrait smashes in from the side with an "OI!" bark, and the saviour's line overrides whatever was being said. It reads clearly because it's rude, and it's the funniest beat in the prototype.

**Outcome, then Trophy.** The announcer's verdict and a big rubber stamp (DEFEATED / FLED / SOMEHOW WON) come first. Then the Trophy flies from the loser to the winner and stays on the winner's portrait. The Blame line comes last, in Herald type: "Rumour planted by Haris, who has been informed."

**The shareable card is a Herald clipping.** It mixes A's poster and C's front page: a mock tabloid cutting with the headline, both portraits (with the Trophy), the loser's last line as a big pull quote, and the Blame line at the bottom. A pull quote of something stupid is what people actually forward, and the Blame line makes the card an accusation in itself. B's receipt was cut.

**Rejected:** B's chat-panel stage and trading-card Introduction (too app-like), tap-to-advance pacing, and C's article as the live stage.

## Comments

- 2026-10-29: Prototype built on throwaway branch [`prototype/clash-and-introduction-cards`](https://github.com/abdullah12353/orc-simulator/blob/prototype/clash-and-introduction-cards/.scratch/orc-nonsense/prototypes/clash-cards.prototype.html) (never merged). It's a single HTML file: open it, then use `?variant=A|B|C` or the bottom bar. A = Fight Night (full-screen broadcast, auto-play, poster card). B = Pub Strip (phone chat panels, trading-card Introduction, receipt card). C = Gutter Herald front page (the article builds itself, the front page is the card). Each variant plays the same Introduction, Clash and Clash + wrong saviour scripts. Awaiting Mohammed's reaction.
- 2026-10-29: Resolved by Claude on Mohammed's instruction to pick whatever is funniest. The prototype branch stays unmerged as a reference.
