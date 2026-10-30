// The Captain Introduction (#33, gdd §4.4, #10): a set piece of about 7 s for Return, `stepped_in` (and
// later `crowned`) heads. Announcer stinger → portrait slam → the Captain shouts his own name, badly →
// the announcer adds the Epithet, deadpan → one signature line in the Captain's voice. Every sound is
// prerecorded (paths from @orc/content's audio bank). This is the script; the PWA's card plays it.
import { epithetPath, introShoutPath, introSignaturePath, stingerPath, type Content } from '@orc/content';
import type { CaptainId, Introduction } from './types.ts';

export type IntroBeatKind = 'stinger' | 'slam' | 'shout' | 'epithet' | 'signature';

export interface IntroBeat {
  kind: IntroBeatKind;
  /** How long the beat holds. */
  ms: number;
  /** The prerecorded clip it plays, if any. */
  clip: string | null;
  speaker: CaptainId | 'announcer' | null;
  /** What is said (shown big for the shout and Epithet, as a quote for the signature line). */
  text: string | null;
  /** Through a mouth bandage: the clip plays muffled. */
  muffled: boolean;
  /** A muffled Captain's words, subtitled, since nobody can make them out. */
  subtitle: string | null;
}

export interface IntroductionScript {
  captainId: CaptainId;
  /** The name he goes by: his alias while disguised. */
  name: string;
  /** His real name, when he's in disguise. */
  really: string | null;
  epithet: string | null;
  legendary: boolean;
  beats: IntroBeat[];
}

const VOWELS = /[AEIOUÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÄËÏÖÜ]+/;

/** "Krúg" → "KRÚÚÚG!": shouted, with the first vowel dragged out far too long. */
export function shoutName(name: string): string {
  const loud = name.toUpperCase();
  const m = VOWELS.exec(loud);
  if (!m) return `${loud}!`;
  const end = m.index + m[0].length;
  return `${loud.slice(0, end)}${m[0].at(-1)!.repeat(2)}${loud.slice(end)}!`;
}

/** The Introduction's beats. `muffled`: he has a mouth bandage as he comes in. */
export function introductionScript(
  content: Content,
  intro: Introduction,
  { muffled = false }: { muffled?: boolean } = {},
): IntroductionScript {
  const id = intro.captainId;
  const card = content.cast.find((c) => c.id === id);
  const real = card?.name ?? id;
  const alias = intro.aliasIdx !== null ? card?.aliases[intro.aliasIdx] : undefined;
  const name = alias ?? real;
  const epithet = intro.epithet ? (content.banks.epithets[intro.epithet]?.text ?? null) : null;

  const his = (kind: IntroBeatKind, ms: number, clip: string, text: string): IntroBeat => ({
    kind,
    ms,
    clip,
    speaker: id,
    text,
    muffled,
    subtitle: muffled ? text : null,
  });
  const beats: IntroBeat[] = [
    { kind: 'stinger', ms: 900, clip: stingerPath('intro'), speaker: null, text: null, muffled: false, subtitle: null },
    { kind: 'slam', ms: 700, clip: null, speaker: null, text: null, muffled: false, subtitle: null },
    his('shout', epithet ? 1700 : 2400, introShoutPath(id, alias !== undefined ? intro.aliasIdx : null), shoutName(name)),
  ];
  if (epithet) {
    beats.push({
      kind: 'epithet',
      ms: 1600,
      clip: epithetPath(intro.epithet!),
      speaker: 'announcer',
      text: `…${epithet.toUpperCase()}.`,
      muffled: false,
      subtitle: null,
    });
  }
  beats.push(his('signature', epithet ? 2300 : 2900, introSignaturePath(id), card?.catchphrase ?? ''));

  return { captainId: id, name, really: alias ? real : null, epithet, legendary: intro.legendary, beats };
}
