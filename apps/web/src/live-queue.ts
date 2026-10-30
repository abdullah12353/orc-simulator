// What plays live (#31): from a tick's new Facts, Clashes play as their card and other notable story
// heads (anything not silent) show as a short notice. One thing plays at a time, in the order the
// world produced them; Introductions (#33) join as their own kind.

export interface LiveFact {
  no: number;
  story_no: number;
  tick_seq: number;
  kind: string;
  tier: 'generated' | 'templated' | 'silent';
  line: string;
}

export type LiveItem = { kind: 'clash'; no: number } | { kind: 'notice'; no: number; line: string };

/** How much may wait to play. Past it the oldest notices go first; Clashes are never dropped. */
export const LIVE_BACKLOG = 8;

/** The playable story heads among new Facts, oldest first. Consequences ride along with their head. */
export function liveItems(facts: LiveFact[]): LiveItem[] {
  return facts
    .filter((f) => f.no === f.story_no && f.tier !== 'silent')
    .sort((a, b) => a.no - b.no)
    .flatMap((f): LiveItem[] => {
      if (f.kind === 'clash') return [{ kind: 'clash', no: f.no }];
      return f.line ? [{ kind: 'notice', no: f.no, line: f.line }] : [];
    });
}

/** Adds new items behind what's already queued (the first item is the one playing). */
export function enqueue(queue: LiveItem[], items: LiveItem[]): LiveItem[] {
  const known = new Set(queue.map((i) => i.no));
  const next = [...queue, ...items.filter((i) => !known.has(i.no))];
  // Trim notices oldest first, never the one on stage.
  for (let i = 1; next.length > LIVE_BACKLOG && i < next.length; ) {
    if (next[i]!.kind === 'notice') next.splice(i, 1);
    else i++;
  }
  return next;
}
