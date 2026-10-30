// The audio player (#30): prerecorded barks and stingers from the static bank (no runtime TTS, D26).
// One shared Web Audio context; clips are fetched and decoded once, then reused. Every play resolves
// when the clip ends, or straight away when muted, blocked by the browser's autoplay rule, or missing,
// so a card never waits on sound. Introductions (#33) and Accusation name clips (#39) play through it too.
import { barkPath, stingerPath, type BarkEmotion, type Stinger } from '@orc/content';

export interface PlayOptions {
  /** A mouth bandage: the Captain's own bark through a low-pass filter (#19's recommendation; #33 uses it). */
  muffled?: boolean;
  /** 0–1. */
  volume?: number;
}

const MUTE_KEY = 'orc:muted';
const MUFFLE_HZ = 550;

class AudioPlayer {
  private ctx: AudioContext | null = null;
  private readonly clips = new Map<string, Promise<AudioBuffer | null>>();
  private readonly playing = new Set<AudioBufferSourceNode>();
  private readonly listeners = new Set<(muted: boolean) => void>();
  muted = typeof localStorage !== 'undefined' && localStorage.getItem(MUTE_KEY) === '1';

  /** The context, created on first use. Browsers start it suspended until the page has had a tap. */
  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof AudioContext === 'undefined') return null;
    this.ctx = new AudioContext();
    // Any later tap or key unlocks it (the first open of the Herald may auto-play before one).
    const unlock = () => void this.ctx?.resume();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return this.ctx;
  }

  /** Fetches and decodes a clip once. A missing or broken file is null, never an error. */
  load(path: string): Promise<AudioBuffer | null> {
    let clip = this.clips.get(path);
    if (!clip) {
      const ctx = this.context();
      clip = !ctx
        ? Promise.resolve(null)
        : fetch(/^https?:\/\//.test(path) ? path : `${import.meta.env.BASE_URL}${path}`)
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status} ${path}`))))
            .then((bytes) => ctx.decodeAudioData(bytes))
            .catch(() => null);
      this.clips.set(path, clip);
    }
    return clip;
  }

  /** Warms the cache for clips a card is about to play. */
  preload(paths: string[]): void {
    for (const p of paths) void this.load(p);
  }

  /** Plays a clip; resolves when it has finished (or at once if it can't play). */
  async play(path: string, opts: PlayOptions = {}): Promise<void> {
    if (this.muted) return;
    const ctx = this.context();
    if (!ctx) return;
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    if (ctx.state !== 'running') return; // still blocked: the card plays silently
    const clip = await this.load(path);
    if (!clip || this.muted) return;

    const source = ctx.createBufferSource();
    source.buffer = clip;
    const gain = ctx.createGain();
    gain.gain.value = opts.volume ?? 1;
    let tail: AudioNode = gain;
    if (opts.muffled) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = MUFFLE_HZ;
      gain.connect(filter);
      tail = filter;
    }
    source.connect(gain);
    tail.connect(ctx.destination);
    this.playing.add(source);
    await new Promise<void>((resolve) => {
      source.onended = () => {
        this.playing.delete(source);
        resolve();
      };
      source.start();
    });
  }

  /** Cuts everything off (a skipped beat, a closed card). */
  stopAll(): void {
    for (const s of this.playing) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    this.playing.clear();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    if (muted) this.stopAll();
    for (const l of this.listeners) l(muted);
  }

  onMutedChange(listener: (muted: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const audio = new AudioPlayer();

/** A Captain's bark for an emotion. */
export const bark = (captainId: string, emotion: BarkEmotion, opts?: PlayOptions) => audio.play(barkPath(captainId, emotion), opts);

/** One of the announcer's stingers. */
export const sting = (name: Stinger) => audio.play(stingerPath(name));

/**
 * An accuser's clip of a Player's mangled name (#39), by its storage key. Name clips live in storage (R2),
 * served from `VITE_NAME_CLIPS_URL`; without it (local dev) the key is a path under the PWA's public root.
 */
export const nameClip = (clipKey: string) => {
  const base = import.meta.env.VITE_NAME_CLIPS_URL as string | undefined;
  return audio.play(base ? `${base.replace(/\/$/, '')}/${clipKey}` : clipKey);
};
