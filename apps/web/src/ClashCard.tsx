// The Clash card (#30, design settled on #10 from the prototype's "Fight Night" variant): full screen,
// about 15 s, auto-play with tap to skip ahead. Stinger → both portraits slam in with a bark each → the
// lines as subtitles (jab, comeback, the loser's last word) → a wrong saviour crashes in as a hard
// interruption → the outcome stamp → the Trophy flies to the winner → the Blame line in Herald type.
// Line text is read from `data.lines` as each beat plays, so generated lines arriving mid-card (#37)
// swap in from the next line on.
import { useEffect, useMemo, useState } from 'react';
import { BARK_EMOTIONS, barkPath, content } from '@orc/content';
import { clashShape } from '@orc/sim';
import { bark, sting, audio } from './audio.ts';
import { BlameLine } from './BlameLine.tsx';
import { useCardPlayer, type Beat } from './card-player.ts';
import type { ClashCardData } from './clash-card-data.ts';
import { Portrait } from './Portrait.tsx';

type Kind = 'stinger' | 'slam-a' | 'slam-b' | 'line' | 'crash' | 'outcome' | 'trophy' | 'blame';
type ClashBeat = Beat<Kind> & { line?: number };

const cards = new Map(content.cast.map((c) => [c.id, c]));
const nameOf = (id: string) => cards.get(id)?.name ?? id;

/** How long a subtitled line holds: long enough to read, never so long it drags. */
const lineMs = (text: string) => Math.max(2000, Math.min(3200, 1300 + 40 * text.length));

/** The beats of one Clash: about 15 s, about 4 s more with a wrong saviour. */
export function clashBeats(data: ClashCardData): ClashBeat[] {
  const { clash, lines } = data;
  const shape = clashShape(clash);
  const loserSound = clash.outcome === 'fled' ? 'scared' : 'pain';
  const beats: ClashBeat[] = [
    { kind: 'stinger', ms: 800, enter: () => void sting('clash') },
    { kind: 'slam-a', ms: 500, enter: () => void bark(clash.a, 'taunt') },
    { kind: 'slam-b', ms: 1000, enter: () => void bark(clash.b, 'taunt') },
  ];
  for (let i = 0; i < shape.lines; i++) {
    const speaker = lines[i]?.speaker;
    if (clash.saviour && speaker === clash.saviour) {
      beats.push({
        kind: 'crash',
        line: i,
        ms: 3600,
        enter: () => {
          void sting('crash');
          void bark(clash.saviour!, 'oi');
        },
      });
    } else {
      beats.push({ kind: 'line', line: i, ms: lineMs(lines[i]?.text ?? '') });
    }
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
function stamp(data: ClashCardData): { text: string; verdict: string } {
  const { clash } = data;
  const winnerOdds = clash.winner === clash.a ? clash.pA : 1 - clash.pA;
  const winner = nameOf(clash.winner).toUpperCase();
  const loser = nameOf(clash.loser).toUpperCase();
  if (clash.outcome === 'fled') return { text: 'FLED', verdict: `${loser}… HAS FLED.` };
  if (winnerOdds < 0.35) return { text: 'SOMEHOW WON', verdict: `${winner}… HAS SOMEHOW WON.` };
  return { text: 'DEFEATED', verdict: `${loser}… HAS BEEN DEFEATED… BY ${winner}.` };
}

export function ClashCard({ data, reader, onDone }: { data: ClashCardData; reader: string; onDone: () => void }) {
  const beats = useMemo(() => {
    const ids = [data.clash.a, data.clash.b, ...(data.clash.saviour ? [data.clash.saviour] : [])];
    audio.preload(ids.flatMap((id) => BARK_EMOTIONS.map((e) => barkPath(id, e))));
    return clashBeats(data);
    // One run per Clash: generated lines swap in through `data.lines`, never by rebuilding the beats.
  }, [data.clash.no]);
  const { beat, index, skip, finish } = useCardPlayer(beats, onDone);
  const { clash, lines } = data;
  const at = (kind: Kind) => beats.findIndex((b) => b.kind === kind);
  const reached = (kind: Kind) => at(kind) >= 0 && index >= at(kind);

  const speaking = beat?.line !== undefined ? lines[beat.line] : undefined;
  const settled = reached('outcome');
  const { text: stampText, verdict } = stamp(data);
  const trophyText = data.trophy ? (content.banks.trophies[data.trophy.key]?.text ?? data.trophy.key) : null;
  const side = (id: string) => (id === clash.a ? 'left' : 'right');

  const portrait = (id: string, which: 'left' | 'right') => {
    const classes = ['side', which];
    if (reached(which === 'left' ? 'slam-a' : 'slam-b')) classes.push('in');
    if (speaking && speaking.speaker !== id && beat?.kind === 'line') classes.push('dim');
    if (settled && id === clash.loser) classes.push('loser');
    return (
      <div className={classes.join(' ')}>
        <Portrait portraitKey={cards.get(id)?.portraitKey ?? id} name={nameOf(id)} size={160} />
        {reached('trophy') && data.trophy && id === clash.winner && <span className="kept">{trophyText}</span>}
      </div>
    );
  };

  return (
    <div
      className={`clash-card${beat?.kind === 'crash' ? ' judder' : ''}`}
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
      <div className="nameplate np-left">{reached('slam-a') && nameOf(clash.a)}</div>
      <div className="nameplate np-right">{reached('slam-b') && nameOf(clash.b)}</div>
      {portrait(clash.a, 'left')}
      {portrait(clash.b, 'right')}
      <div className={`vs${beat?.kind === 'slam-b' ? ' on' : ''}`}>VS</div>

      {clash.saviour && (
        <div className={`crash${beat?.kind === 'crash' ? ' on' : ''}`}>
          <span className="burst">OI!</span>
          <Portrait portraitKey={cards.get(clash.saviour)?.portraitKey ?? clash.saviour} name={nameOf(clash.saviour)} size={150} />
        </div>
      )}

      <div className={`stamp${settled ? ' on' : ''}`}>{stampText}</div>
      {data.trophy && (
        <div className={`trophy from-${side(data.trophy.from)}${reached('trophy') ? ' fly' : ''}`}>{trophyText}</div>
      )}

      <div className="sub">
        {speaking && (
          <>
            <span className="who">
              {nameOf(speaking.speaker)}
              {beat?.kind === 'crash' ? ', uninvited' : ''}
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

function MuteButton() {
  const [muted, setMuted] = useState(audio.muted);
  useEffect(() => audio.onMutedChange(setMuted), []);
  return <button onClick={() => audio.setMuted(!muted)}>{muted ? 'Sound off' : 'Sound on'}</button>;
}
