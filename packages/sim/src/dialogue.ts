// Clash dialogue (#30, #10): 3 lines (jab, comeback, the loser's last word), or 4 when a wrong saviour
// crashes in. `clashShape` is the one definition of that shape: the fallback script here, the narration
// prompt and its validator (#37) and the Clash card all follow it. Stored as `clash_dialogue.lines`.
import type { ClashSpeaker, Content } from '@orc/content';
import type { CaptainId, ClashFact } from './types.ts';

/** One spoken line, as stored in `clash_dialogue.lines`: the speaker is a Captain slug. */
export interface ClashLine {
  speaker: CaptainId;
  text: string;
}

export interface ClashShape {
  /** How many lines: 3, or 4 with a wrong saviour. */
  lines: 3 | 4;
  /** Who may speak: the pair, and the saviour if he came. */
  speakers: CaptainId[];
  /** Who must speak last. */
  loser: CaptainId;
}

export function clashShape(f: ClashFact): ClashShape {
  return {
    lines: f.saviour ? 4 : 3,
    speakers: f.saviour ? [f.a, f.b, f.saviour] : [f.a, f.b],
    loser: f.loser,
  };
}

/** Does `lines` fit the Clash's shape? Returns the problem, or null. Narration (#37) adds tone checks on top. */
export function shapeProblem(f: ClashFact, lines: readonly ClashLine[]): string | null {
  const shape = clashShape(f);
  if (lines.length !== shape.lines) return `needs ${shape.lines} lines, got ${lines.length}`;
  if (lines.some((l) => !shape.speakers.includes(l.speaker))) return 'a line has a speaker who is not in the Clash';
  if (lines.some((l) => typeof l.text !== 'string' || l.text.trim() === '')) return 'a line is empty';
  if (lines.at(-1)!.speaker !== shape.loser) return 'the loser must speak last';
  if (f.saviour && !lines.some((l) => l.speaker === f.saviour)) return 'the wrong saviour never speaks';
  return null;
}

/** The Clash's fallback script (`fact.fallbackKey`), with names and the magnet filled in. */
export function fallbackDialogue(content: Content, f: ClashFact): ClashLine[] {
  const script = content.banks.clash.scripts[f.fallbackKey];
  if (!script) throw new Error(`fallbackDialogue: no Clash script "${f.fallbackKey}"`);
  const names = new Map(content.cast.map((c) => [c.id, c.name]));
  const who: Record<ClashSpeaker, CaptainId | undefined> = { winner: f.winner, loser: f.loser, saviour: f.saviour };
  const slots: Record<string, string> = {
    winner: names.get(f.winner) ?? f.winner,
    loser: names.get(f.loser) ?? f.loser,
    saviour: f.saviour ? (names.get(f.saviour) ?? f.saviour) : '',
    magnet: f.saviourMagnet ?? content.banks.clash.anyMagnet,
  };
  return script.lines.map((l) => ({
    speaker: who[l.speaker]!,
    text: l.text.replace(/\{([^}]+)\}/g, (m, key: string) => slots[key] ?? m),
  }));
}
