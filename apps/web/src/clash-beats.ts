// The Clash card's dialogue beats (#30), decided from the lines as they are when the beat plays, so
// generated lines arriving mid-card (#37) move the wrong saviour's crash to wherever he speaks in them.
// Pure, so it's tested in apps/web/test.

interface Line {
  speaker: string;
  text: string;
}

/** How long a crash holds: the stinger, his bark and his line. */
export const CRASH_MS = 3600;

/** How long a subtitled line holds: long enough to read, never so long it drags. */
export const lineMs = (text: string) => Math.max(2000, Math.min(3200, 1300 + 40 * text.length));

/** Dialogue beat `i` as of `lines`: the saviour's line crashes in; any other is a plain line. */
export function dialogueBeat(lines: readonly Line[], i: number, saviour: string | null | undefined): { kind: 'line' | 'crash'; ms: number } {
  const l = lines[i];
  if (saviour && l?.speaker === saviour) return { kind: 'crash', ms: CRASH_MS };
  return { kind: 'line', ms: lineMs(l?.text ?? '') };
}
