// The Captain Introduction card (#33, gdd §4.4, staged like the Clash's "Fight Night", #10): about 7 s,
// auto-play, tap to skip ahead. Announcer stinger → his portrait slams in → he shouts his own name, badly
// → the announcer adds the Epithet, deadpan → his signature line. A muffled Captain's clips play through
// the bandage and his words are subtitled. The script comes from @orc/sim's `introductionScript`.
import { useMemo } from 'react';
import { audio } from './audio.ts';
import { useCardPlayer, type Beat } from './card-player.ts';
import type { IntroductionCardData } from './introduction-data.ts';
import type { IntroBeat, IntroBeatKind } from '@orc/sim';
import { MuteButton } from './MuteButton.tsx';
import { Portrait } from './Portrait.tsx';

type IntroCardBeat = Beat<IntroBeatKind> & { step: IntroBeat };

export function IntroductionCard({ data, onDone }: { data: IntroductionCardData; onDone: () => void }) {
  const { script, face } = data;
  const beats = useMemo((): IntroCardBeat[] => {
    audio.preload(script.beats.flatMap((b) => (b.clip ? [b.clip] : [])));
    return script.beats.map((step) => ({
      kind: step.kind,
      ms: step.ms,
      step,
      enter: step.clip ? () => void audio.play(step.clip!, { muffled: step.muffled }) : undefined,
    }));
  }, [data.no]);
  const { beat, index, skip, finish } = useCardPlayer(beats, onDone);
  const reached = (kind: IntroBeatKind) => {
    const at = beats.findIndex((b) => b.kind === kind);
    return at >= 0 && index >= at;
  };
  const textOf = (kind: IntroBeatKind) => script.beats.find((b) => b.kind === kind)?.text ?? '';
  const subtitle = beat?.step.subtitle;

  return (
    <div className="clash-card intro-card" role="dialog" aria-label={`Introducing ${script.name}`} onClick={skip}>
      <div className="controls" onClick={(e) => e.stopPropagation()}>
        <MuteButton />
        <button onClick={finish} aria-label="Close the Introduction">
          ✕
        </button>
      </div>
      <div className={`intro-portrait${reached('slam') ? ' in' : ''}${beat?.kind === 'shout' ? ' shouting' : ''}`}>
        <Portrait face={face} name={script.name} size={240} />
      </div>
      <div className="intro-name">
        {reached('shout') && <span className="shout">{textOf('shout')}</span>}
        {reached('epithet') && <span className="epithet">{textOf('epithet')}</span>}
        {script.really && reached('shout') && <span className="really">(really {script.really})</span>}
      </div>
      {beat?.kind === 'signature' && !beat.step.muffled && <p className="intro-line">“{beat.step.text}”</p>}
      {subtitle && (
        <div className="sub">
          <span className="who">{script.name} (muffled)</span>
          <span className="txt">{subtitle}</span>
        </div>
      )}
      <p className="tap-hint">Tap to skip ahead</p>
    </div>
  );
}
