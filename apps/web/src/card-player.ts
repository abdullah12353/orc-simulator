// The card player (#10, #30): a set piece is a list of beats on a fixed rhythm. It auto-plays; a tap
// skips to the next beat and never pauses (comic timing is the director's job). The Clash card uses it
// now; the Introduction card (#33) and Hall replays (#40) reuse it with their own beats.
import { useCallback, useEffect, useRef, useState } from 'react';
import { audio } from './audio.ts';

export interface Beat<K extends string = string> {
  /** What the stage shows during this beat. */
  kind: K;
  /** How long the beat holds before the next one. */
  ms: number;
  /** Sound or other side effects when the beat starts (fire and forget: a beat never waits on audio). */
  enter?: () => void;
}

export interface CardPlayer<B extends Beat> {
  /** The beat on stage, or null once the card has finished. */
  beat: B | null;
  index: number;
  /** Jump to the next beat now. */
  skip: () => void;
  /** Jump to the end. */
  finish: () => void;
}

/**
 * Plays `beats` from the start (remount with a new `key` to play again). Keep `beats` stable (useMemo);
 * `onDone` fires once when the last beat ends or the card is finished early.
 */
export function useCardPlayer<B extends Beat>(beats: B[], onDone?: () => void): CardPlayer<B> {
  const [index, setIndex] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;
  // Each beat's sound starts once, even when StrictMode runs the effect twice.
  const entered = useRef(-1);

  useEffect(() => {
    if (index >= beats.length) {
      audio.stopAll();
      if (entered.current !== beats.length) done.current?.();
      entered.current = beats.length;
      return;
    }
    if (entered.current !== index) beats[index]!.enter?.();
    entered.current = index;
    const timer = window.setTimeout(() => setIndex((i) => (i === index ? i + 1 : i)), beats[index]!.ms);
    return () => window.clearTimeout(timer);
  }, [index, beats]);

  const skip = useCallback(() => {
    audio.stopAll();
    setIndex((i) => Math.min(i + 1, beats.length));
  }, [beats.length]);
  const finish = useCallback(() => setIndex(beats.length), [beats.length]);

  return { beat: beats[index] ?? null, index, skip, finish };
}
