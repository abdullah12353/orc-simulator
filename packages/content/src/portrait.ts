// The portrait compositor's rules (#18, D60, #33), pure so Captain cards, Clash cards, Introductions
// and Clippings (#41) all stack a Captain's shame the same way. Every portrait is a lossy WebP drawn to
// one shared template face box; overlays are WebP layers drawn once for that box and combined in the
// browser. A card may nudge an overlay where its outline leaves the box (`CastCard.faceBox`).
//
// Rules: at most 3 overlays show. The newest pick which; the mouth bandage and the active disguise are
// pinned into the 3 (what you hear and the name he goes by must match the face); a lost tusk and the
// Legendary stamp sit outside the limit. Layers stack by slot, bottom first; within a slot the newer
// one goes on top.
import type { BankKey, CaptainId, Content } from './types.ts';

/** The template every portrait and overlay is drawn to (512×640 WebP, #18). */
export const PORTRAIT_TEMPLATE = { width: 512, height: 640 } as const;
/** How many overlays may show, not counting the ones outside the limit. */
export const OVERLAY_LIMIT = 3;
/** The Legendary stamp's slot: a frame, above everything on the face. */
export const LEGENDARY_SLOT = 9;
/** The stamp's layer key (it isn't a Humiliation). */
export const LEGENDARY_LAYER = 'legendary';

/** One active Humiliation on a Captain: its bank key and row number (row numbers rise with time). */
export interface PortraitMark {
  key: BankKey;
  no: number;
}

/** A sparse per-portrait nudge for one overlay, in template pixels (and a scale about its centre). */
export interface LayerNudge {
  x?: number;
  y?: number;
  scale?: number;
}

export interface PortraitLayer {
  /** The Humiliation kind, or `legendary` for the stamp. */
  key: string;
  slot: number;
  /** The overlay's WebP, relative to the PWA's public root. */
  src: string;
  /** This portrait's override for the layer, if it has one. */
  nudge?: LayerNudge;
}

export interface ComposedPortrait {
  captainId: CaptainId;
  portraitKey: string;
  /** The base portrait's WebP. */
  base: string;
  /** What to draw over the base, bottom first. */
  layers: PortraitLayer[];
  /** Active overlays the limit leaves off, newest first. */
  hidden: BankKey[];
  /** A mouth bandage: his barks are muffled and his lines subtitled. */
  muffled: boolean;
}

export const portraitPath = (portraitKey: string) => `portraits/${portraitKey}.webp`;
export const overlayPath = (key: string) => `portraits/overlays/${key}.webp`;

/** A `humiliations` row, ended or not (ended rows are kept as history). */
export interface HumiliationRow {
  kind: BankKey;
  no: number;
  gainedFact: number;
  endedFact: number | null;
}

/**
 * His marks as of a Fact: gained at or before it, not ended by then. Fact numbers rise with time, so a
 * card shows the face as it was in its story (a Clash at its head; an Introduction once the Return's own
 * Humiliation has landed, i.e. as of the story's last Fact), and a Clipping (#41) can freeze it.
 */
export function marksAsOf(rows: HumiliationRow[], factNo: number): PortraitMark[] {
  return rows
    .filter((r) => r.gainedFact <= factNo && (r.endedFact === null || r.endedFact > factNo))
    .sort((a, b) => a.no - b.no)
    .map((r) => ({ key: r.kind, no: r.no }));
}

export function composePortrait(
  content: Content,
  { captainId, marks, legendary = false }: { captainId: CaptainId; marks: PortraitMark[]; legendary?: boolean },
): ComposedPortrait {
  const card = content.cast.find((c) => c.id === captainId);
  const bank = content.banks.humiliations;
  const defOf = (m: PortraitMark) => bank[m.key];

  const newest = [...marks].sort((a, b) => b.no - a.no);
  const overlays = newest.filter((m) => defOf(m)?.overlay);
  const outside = overlays.filter((m) => defOf(m)!.overlay!.outsideLimit);
  const limited = overlays.filter((m) => !defOf(m)!.overlay!.outsideLimit);
  const pinned = limited.filter((m) => defOf(m)!.overlay!.pinned).slice(0, OVERLAY_LIMIT);
  const picked = [...pinned];
  for (const m of limited) {
    if (picked.length >= OVERLAY_LIMIT) break;
    if (!picked.includes(m)) picked.push(m);
  }

  const visible = [...picked, ...outside];
  const layers: (PortraitLayer & { no: number })[] = visible.map((m) => ({
    key: m.key,
    slot: defOf(m)!.overlay!.slot,
    src: overlayPath(m.key),
    no: m.no,
  }));
  if (legendary) layers.push({ key: LEGENDARY_LAYER, slot: LEGENDARY_SLOT, src: overlayPath(LEGENDARY_LAYER), no: Infinity });
  layers.sort((a, b) => a.slot - b.slot || a.no - b.no);

  return {
    captainId,
    portraitKey: card?.portraitKey ?? captainId,
    base: portraitPath(card?.portraitKey ?? captainId),
    layers: layers.map(({ no: _no, ...layer }) => {
      const nudge = card?.faceBox?.[layer.key];
      return nudge ? { ...layer, nudge } : layer;
    }),
    hidden: limited.filter((m) => !picked.includes(m)).map((m) => m.key),
    muffled: marks.some((m) => defOf(m)?.muffled),
  };
}
