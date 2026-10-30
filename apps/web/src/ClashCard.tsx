// The Clash card (#30, design settled on #10 from the prototype's "Fight Night" variant): full screen,
// about 15 s, auto-play with tap to skip ahead. Stinger → both portraits slam in with a bark each → the
// lines as subtitles (jab, comeback, the loser's last word) → a wrong saviour crashes in as a hard
// interruption → the outcome stamp → the Trophy flies to the winner → the Blame line in Herald type.
// Line text is read from `data.lines` as each beat plays, so generated lines arriving mid-card (#37)
// swap in from the next line on.
import { useMemo, useRef } from 'react';
import { BARK_EMOTIONS, barkPath, content, type BarkEmotion } from '@orc/content';
import { clashShape, type ClashLine } from '@orc/sim';
import { bark as playBark, sting, audio } from './audio.ts';
import { BlameLine } from './BlameLine.tsx';
import { useCardPlayer, type Beat } from './card-player.ts';
import { dialogueBeat } from './clash-beats.ts';
import { captainName } from './captain-names.ts';
import type { ClashCardData } from './clash-card-data.ts';
import { MuteButton } from './MuteButton.tsx';
import { bareFace, Portrait } from './Portrait.tsx';

/** A `dialogue` beat is a line, or the wrong saviour crashing in: which, it decides as it plays (#37). */
type Kind = 'stinger' | 'slam-a' | 'slam-b' | 'dialogue' | 'outcome' | 'trophy' | 'blame';
type ClashBeat = Beat<Kind> & { line?: number };

/**
 * The beats of one Clash: about 15 s, about 4 s more with a wrong saviour. `lines` gives the lines as they
 * are now: each dialogue beat reads them when it starts, so generated lines that land mid-card with the
 * saviour in another position move his crash with him.
 */
export function clashBeats(data: ClashCardData, lines: () => ClashLine[]): ClashBeat[] {
  const { clash } = data;
  // A mouth bandage muffles his barks (#33); his lines are subtitles anyway, marked as muffled.
  const bark = (id: string, emotion: BarkEmotion) => playBark(id, emotion, { muffled: data.faces[id]?.muffled });
  const shape = clashShape(clash);
  const loserSound = clash.outcome === 'fled' ? 'scared' : 'pain';
  const beats: ClashBeat[] = [
    { kind: 'stinger', ms: 800, enter: () => void sting('clash') },
    { kind: 'slam-a', ms: 500, enter: () => void bark(clash.a, 'taunt') },
    { kind: 'slam-b', ms: 1000, enter: () => void bark(clash.b, 'taunt') },
  ];
  for (let i = 0; i < shape.lines; i++) {
    beats.push({
      kind: 'dialogue',
      line: i,
      get ms() {
        return dialogueBeat(lines(), i, clash.saviour).ms;
      },
      enter: () => {
        if (dialogueBeat(lines(), i, clash.saviour).kind !== 'crash') return;
        void sting('crash');
        void bark(clash.saviour!, 'oi');
      },
    });
  }
  beats.push({
    kind: 'outcome',
    ms: 2200,
    enter: () => {
      void sting('verdict');
      void bark(clash.loser, loserSound);
    },
  });
  if (data.trophy) {
    beats.push({
      kind: 'trophy',
      ms: 1600,
      enter: () => {
        void sting('trophy');
        void bark(clash.winner, 'triumph');
      },
    });
  }
  if (data.blameLine) beats.push({ kind: 'blame', ms: 1800 });
  return beats;
}

/** The stamp: FLED, SOMEHOW WON for an upset, otherwise DEFEATED (over the loser). */
function stamp(data: ClashCardData, nameOf: (id: string) => string): { text: string; verdict: string } {
  const { clash } = data;
  const winnerOdds = clash.winner === clash.a ? clash.pA : 1 - clash.pA;
  const winner = nameOf(clash.winner).toUpperCase();
  const loser = nameOf(clash.loser).toUpperCase();
  if (clash.outcome === 'fled') return { text: 'FLED', verdict: `${loser}… HAS FLED.` };
  if (winnerOdds < 0.35) return { text: 'SOMEHOW WON', verdict: `${winner}… HAS SOMEHOW WON.` };
  return { text: 'DEFEATED', verdict: `${loser}… HAS BEEN DEFEATED… BY ${winner}.` };
}

export function ClashCard({ data, reader, onDone }: { data: ClashCardData; reader: string; onDone: () => void }) {
  const current = useRef(data.lines);
  current.current = data.lines;
  const beats = useMemo(() => {
    const ids = [data.clash.a, data.clash.b, ...(data.clash.saviour ? [data.clash.saviour] : [])];
    audio.preload(ids.flatMap((id) => BARK_EMOTIONS.map((e) => barkPath(id, e))));
    return clashBeats(data, () => current.current);
    // One run per Clash: generated lines swap in through `data.lines`, never by rebuilding the beats.
  }, [data.clash.no]);
  const { beat, index, skip, finish } = useCardPlayer(beats, onDone);
  const { clash, lines } = data;
  const at = (kind: Kind) => beats.findIndex((b) => b.kind === kind);
  const reached = (kind: Kind) => at(kind) >= 0 && index >= at(kind);

  // A disguised Captain goes by his alias (US78).
  const nameOf = (id: string) => data.names[id] ?? captainName(id);
  const speaking = beat?.line !== undefined ? lines[beat.line] : undefined;
  const crashing = beat?.line !== undefined && dialogueBeat(lines, beat.line, clash.saviour).kind === 'crash';
  const settled = reached('outcome');
  const { text: stampText, verdict } = stamp(data, nameOf);
  const trophyText = data.trophy ? (content.banks.trophies[data.trophy.key]?.text ?? data.trophy.key) : null;
  const side = (id: string) => (id === clash.a ? 'left' : 'right');
  // The Warlord is marked wherever he appears (#34).
  const plate = (id: string) => (
    <>
      {nameOf(id)}
      {id === data.warlord && <span className="badge">Warlord</span>}
    </>
  );

  const portrait = (id: string, which: 'left' | 'right') => {
    const classes = ['side', which];
    if (reached(which === 'left' ? 'slam-a' : 'slam-b')) classes.push('in');
    if (speaking && speaking.speaker !== id && !crashing) classes.push('dim');
    if (settled && id === clash.loser) classes.push('loser');
    return (
      <div className={classes.join(' ')}>
        <Portrait face={data.faces[id] ?? bareFace(id)} name={nameOf(id)} size={160} />
        {reached('trophy') && data.trophy && id === clash.winner && <span className="kept">{trophyText}</span>}
      </div>
    );
  };

  return (
    <div
      className={`clash-card${crashing ? ' judder' : ''}`}
      role="dialog"
      aria-label={`Clash: ${nameOf(clash.a)} v ${nameOf(clash.b)}`}
      onClick={skip}
    >
      <div className="controls" onClick={(e) => e.stopPropagation()}>
        <MuteButton />
        <button onClick={finish} aria-label="Close the Clash">
          ✕
        </button>
      </div>
      <div className="nameplate np-left">{reached('slam-a') && plate(clash.a)}</div>
      <div className="nameplate np-right">{reached('slam-b') && plate(clash.b)}</div>
      {portrait(clash.a, 'left')}
      {portrait(clash.b, 'right')}
      <div className={`vs${beat?.kind === 'slam-b' ? ' on' : ''}`}>VS</div>

      {clash.saviour && (
        <div className={`crash${crashing ? ' on' : ''}`}>
          <span className="burst">OI!</span>
          <Portrait face={data.faces[clash.saviour] ?? bareFace(clash.saviour)} name={nameOf(clash.saviour)} size={150} />
        </div>
      )}

      <div className={`stamp${settled ? ' on' : ''}`}>{stampText}</div>
      {data.trophy && <div className={`trophy from-${side(data.trophy.from)}${reached('trophy') ? ' fly' : ''}`}>{trophyText}</div>}

      <div className="sub">
        {speaking && (
          <>
            <span className="who">
              {nameOf(speaking.speaker)}
              {crashing ? ', uninvited' : ''}
              {data.faces[speaking.speaker]?.muffled ? ' (muffled)' : ''}
            </span>
            <span className="txt">{speaking.text}</span>
          </>
        )}
        {beat?.kind === 'outcome' && (
          <>
            <span className="who">The announcer</span>
            <span className="txt">{verdict}</span>
          </>
        )}
        {beat?.kind === 'trophy' && trophyText && (
          <>
            <span className="who">Trophy</span>
            <span className="txt">
              {nameOf(data.trophy!.to)} takes {nameOf(data.trophy!.from)}'s {trophyText}.
            </span>
          </>
        )}
        {beat?.kind === 'blame' && data.blameLine && <BlameLine line={data.blameLine} reader={reader} />}
      </div>
      <p className="tap-hint">Tap to skip ahead</p>
    </div>
  );
}
