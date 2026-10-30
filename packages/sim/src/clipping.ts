// Clippings (#41, D54): any Herald story cut into a shareable card that never changes afterwards. This
// decides what goes on the card, purely: the headline and Blame line as printed, a pull quote (for a
// Clash, the loser's last line; otherwise the edition's Accusation if it ran with the story), both
// portraits composed as they are at clip time, and any Trophy that changed hands. The result is stored
// as `clippings.snapshot` and rendered as-is, so a later Humiliation never changes an old card.
import { composePortrait, type ComposedPortrait, type Content, type PortraitMark } from '@orc/content';
import type { ClashLine } from './dialogue.ts';
import type { CaptainId, Fact, FactNo } from './types.ts';

export interface PullQuote {
  speaker: CaptainId;
  /** The speaker's name as printed. */
  name: string;
  text: string;
}

export interface ClippingPortrait {
  captainId: CaptainId;
  name: string;
  /** Composed at clip time by the shared compositor, and never recomposed. */
  face: ComposedPortrait;
}

export interface ClippingSnapshot {
  storyNo: FactNo;
  kind: Fact['kind'];
  at: string;
  headline: string;
  blameLine: string | null;
  pullQuote: PullQuote | null;
  portraits: ClippingPortrait[];
  trophy: { key: string; text: string; from: CaptainId; to: CaptainId } | null;
  /** The edition it was cut from. */
  edition: { id: string; no: number; orcDate: string } | null;
}

/** A Captain's face at clip time: his current Humiliations, and whether he's Legendary. */
export interface ClippingFace {
  marks: PortraitMark[];
  legendary: boolean;
}

export interface ClippingInput {
  /** The story head. */
  head: Fact;
  /** Every Fact in the story (the head included), for the Trophy. */
  story: Fact[];
  /** A Clash's stored dialogue (fallback or generated). */
  dialogue: ClashLine[] | null;
  /** The edition's Accusation, if it ran with this story. */
  accusation?: Fact | null;
  /** As printed in the edition (a gutter story prints its line). */
  headline: string;
  blameLine: string | null;
  /** Faces at clip time; a Captain missing here is bare. */
  faces: Record<CaptainId, ClippingFace>;
  edition: ClippingSnapshot['edition'];
}

const nameIn = (content: Content, id: CaptainId) => content.cast.find((c) => c.id === id)?.name ?? id;

/**
 * The card's pull quote. A Clash quotes the loser's last line (the shape has him speak last). Any other
 * story quotes the edition's Accusation when it ran with it (`Accuser: "words"`), else has none.
 */
export function pullQuote(
  content: Content,
  head: Fact,
  { dialogue, accusation }: { dialogue?: ClashLine[] | null; accusation?: Fact | null },
): PullQuote | null {
  const name = (id: CaptainId) => nameIn(content, id);
  if (head.kind === 'clash') {
    const line = [...(dialogue ?? [])].reverse().find((l) => l.speaker === head.loser);
    return line ? { speaker: head.loser, name: name(head.loser), text: line.text } : null;
  }
  if (accusation?.kind === 'accusation') {
    const m = /^([^:]+):\s*"(.*)"\s*$/s.exec(accusation.line);
    return { speaker: accusation.accuser, name: m ? m[1]!.trim() : name(accusation.accuser), text: m ? m[2]! : accusation.line };
  }
  return null;
}

/** Whose portraits go on the card: a Clash's pair, else the first two Captains the story cast. */
function portraitIds(head: Fact): CaptainId[] {
  if (head.kind === 'clash') return [head.a, head.b];
  return [...new Set(head.cast)].slice(0, 2);
}

export function buildClipping(content: Content, input: ClippingInput): ClippingSnapshot {
  const { head } = input;
  const trophy = input.story.find((f) => f.kind === 'trophy' && f.storyNo === head.no);
  return {
    storyNo: head.no,
    kind: head.kind,
    at: head.at,
    headline: input.headline,
    blameLine: input.blameLine,
    pullQuote: pullQuote(content, head, input),
    portraits: portraitIds(head).map((captainId) => {
      const face = input.faces[captainId];
      return {
        captainId,
        name: nameIn(content, captainId),
        face: composePortrait(content, { captainId, marks: face?.marks ?? [], legendary: face?.legendary ?? false }),
      };
    }),
    trophy:
      trophy?.kind === 'trophy'
        ? { key: trophy.key, text: content.banks.trophies[trophy.key]?.text ?? trophy.key, from: trophy.from, to: trophy.to }
        : null,
    edition: input.edition,
  };
}
