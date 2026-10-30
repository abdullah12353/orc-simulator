// The prerecorded audio bank's keys (D26, #19): barks per Captain and emotion, and the announcer's
// stingers. No runtime TTS. The build ships placeholder files at these paths (`npm run audio:placeholders`);
// the ElevenLabs renders replace them file for file. Paths are relative to the PWA's public root.

/** What a bark expresses. Each Clash plays one per Captain as his portrait slams in (#10). */
export const BARK_EMOTIONS = ['taunt', 'oi', 'triumph', 'pain', 'scared'] as const;
export type BarkEmotion = (typeof BARK_EMOTIONS)[number];

/** The announcer's stingers: the Clash opener, a wrong saviour's crash, the verdict stamp, a Trophy taken. */
export const STINGERS = ['clash', 'crash', 'verdict', 'trophy'] as const;
export type Stinger = (typeof STINGERS)[number];

export const barkPath = (captainId: string, emotion: BarkEmotion) => `audio/barks/${captainId}/${emotion}.wav`;
export const stingerPath = (name: Stinger) => `audio/stingers/${name}.wav`;
