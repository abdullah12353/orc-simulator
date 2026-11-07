// What the usage guard (#70) tells Players. The Worker's `GET /gutter` says `normal`, `slow` (Neon's month
// is 80 CU-h in: no minute ticks, the fortress moves on the half hour) or `closed` (95: nothing moves till
// the 1st). Pure, so it's tested in apps/web/test; the fetch is GutterNotice.tsx's.

export interface GutterNotice {
  line: string;
  more: string;
}

/** The banner for a `GET /gutter` answer, or null for normal, or for anything we don't understand. */
export function gutterNotice(answer: unknown): GutterNotice | null {
  const state = typeof answer === 'object' && answer !== null ? (answer as { state?: unknown }).state : undefined;
  if (state === 'slow') return { line: "The gutter's gone slow.", more: 'The fortress only moves on the half hour.' };
  if (state === 'closed') return { line: 'The gutter is closed till the 1st.', more: 'Nothing moves in the fortress till then.' };
  return null;
}
