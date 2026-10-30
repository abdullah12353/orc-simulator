// The prerecorded audio bank's keys (D26, #19): barks per Captain and emotion, and the announcer's
// stingers. No runtime TTS. The build ships placeholder files at these paths (`npm run audio:placeholders`);
// the ElevenLabs renders replace them file for file. Paths are relative to the PWA's public root.

/** What a bark expresses. Each Clash plays one per Captain as his portrait slams in (#10). */
export const BARK_EMOTIONS = ['taunt', 'oi', 'triumph', 'pain', 'scared'] as const;
export type BarkEmotion = (typeof BARK_EMOTIONS)[number];

/**
 * The announcer's stingers: the Clash opener, a wrong saviour's crash, the verdict stamp, a Trophy taken,
 * the Introduction's opener (#33), and the fanfare for a Legendary deed leading the Herald (#34, D52).
 */
export const STINGERS = ['clash', 'crash', 'verdict', 'trophy', 'intro', 'fanfare'] as const;
export type Stinger = (typeof STINGERS)[number];

export const barkPath = (captainId: string, emotion: BarkEmotion) => `audio/barks/${captainId}/${emotion}.wav`;
export const stingerPath = (name: Stinger) => `audio/stingers/${name}.wav`;

// Introductions (#33, gdd §4.4): per Captain, prerecorded so the bad pronunciation can be tuned by hand.
/** He shouts his own name, badly; in disguise, the alias he goes by (0 or 1). */
export const introShoutPath = (captainId: string, aliasIdx: 0 | 1 | null = null) =>
  `audio/intros/${captainId}/${aliasIdx === null ? 'shout' : `shout-alias-${aliasIdx}`}.wav`;
/** His one signature line (his catchphrase), in his voice. */
export const introSignaturePath = (captainId: string) => `audio/intros/${captainId}/signature.wav`;
/** The announcer saying an Epithet, deadpan, by its key in `banks.epithets`. */
export const epithetPath = (key: string) => `audio/epithets/${key}.wav`;
