import type { Content } from './types.ts';

/** One Meddle in a story's Blame, already in landing order. */
export interface BlameName {
  name: string;
  verb: 'rumour' | 'dare';
}

/**
 * The Herald's Blame line (data-model §4.1, D53): the earliest landing "began it", the latest
 * "finished the job", and anyone in between is named in order. Null when nobody is to blame.
 */
export function blameLine(content: Content, entries: readonly BlameName[]): string | null {
  if (entries.length === 0) return null;
  const bank = content.banks.blame;
  const began = (e: BlameName) => `${e.name} ${bank.verbs[e.verb].began}`;
  const owned = (e: BlameName) => `${e.name}'s ${bank.verbs[e.verb].noun}`;
  const first = began(entries[0]!);
  if (entries.length === 1) return bank.one.replace('{first}', first);
  const last = owned(entries.at(-1)!);
  if (entries.length === 2) return bank.two.replace('{first}', first).replace('{last}', last);
  const middle = entries.slice(1, -1).map(owned);
  const joined = middle.length === 1 ? middle[0]! : `${middle.slice(0, -1).join(', ')} and ${middle.at(-1)}`;
  return bank.many.replace('{first}', first).replace('{middle}', joined).replace('{last}', last);
}
