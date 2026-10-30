import type { Content } from './types.ts';

/** What a Rumour is about: one of the target's Traits, Fears or Trophies, or (Garbles only) an absurd one. */
export interface SubjectRef {
  from: 'trait' | 'fear' | 'trophy' | 'absurd';
  key: string;
}

/**
 * How a Rumour's subject reads in a line, after "his": "appetite", "fear of water", "secret goose".
 * Trophies have no bank yet (#30), so their slug is spelled out.
 */
export function subjectText(content: Content, subject: SubjectRef): string {
  const { subjects, absurdSubjects } = content.banks;
  if (subject.from === 'absurd') return absurdSubjects[subject.key] ?? subject.key;
  if (subject.from === 'trophy') return subject.key.replace(/-/g, ' ');
  return subjects[subject.key] ?? subject.key.toLowerCase();
}
