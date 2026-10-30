import { useState } from 'react';
import type { ClippingSnapshot } from '@orc/sim';
import { BlameLine } from './BlameLine.tsx';
import { Portrait } from './Portrait.tsx';

// A Clipping (#41, D54): the frozen snapshot of a Herald story, rendered as-is (the faces were composed when
// it was clipped, by the shared compositor, so a later Humiliation never shows here). Share sends it as an
// image through the Web Share API, or downloads it. Not checked by hand in a browser.

export function ClippingCard({
  snapshot,
  reader = '',
  clippedBy,
  onClose,
}: {
  snapshot: ClippingSnapshot;
  reader?: string;
  clippedBy?: string;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const share = async () => {
    setStatus('Printing…');
    try {
      // The image renderer (and react-dom/server) loads only when someone shares.
      const { shareClipping } = await import('./clipping-image.ts');
      const how = await shareClipping(snapshot);
      setStatus(how === 'shared' ? 'Sent.' : how === 'downloaded' ? 'Saved as an image.' : null);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };
  const nameOf = (id: string) => snapshot.portraits.find((p) => p.captainId === id)?.name ?? id;
  return (
    <div className="clipping-backdrop" role="dialog" aria-label="Clipping" onClick={onClose}>
      <article className="clipping" onClick={(e) => e.stopPropagation()}>
        <header>
          <p className="masthead-mini">The Gutter Herald</p>
          {snapshot.edition && (
            <p className="quiet">
              {snapshot.edition.orcDate} · No. {snapshot.edition.no}
            </p>
          )}
        </header>
        <h3>{snapshot.headline}</h3>
        {snapshot.portraits.length > 0 && (
          <div className="clipping-faces">
            {snapshot.portraits.map((p) => (
              <figure key={p.captainId}>
                <Portrait face={p.face} name={p.name} size={140} />
                <figcaption>{p.name}</figcaption>
              </figure>
            ))}
          </div>
        )}
        {snapshot.pullQuote && (
          <blockquote className="pull-quote">
            <p>“{snapshot.pullQuote.text}”</p>
            <cite>{snapshot.pullQuote.name}</cite>
          </blockquote>
        )}
        {snapshot.trophy && (
          <p className="trophy">
            Trophy: {nameOf(snapshot.trophy.to)} took {nameOf(snapshot.trophy.from)}'s {snapshot.trophy.text}.
          </p>
        )}
        {snapshot.blameLine && <BlameLine line={snapshot.blameLine} reader={reader} />}
        {clippedBy && <p className="quiet">Clipped by {clippedBy}</p>}
        <footer className="clipping-actions">
          <button onClick={() => void share()}>Share</button>
          <button className="link" onClick={onClose}>
            Close
          </button>
          {status && <span className="quiet">{status}</span>}
        </footer>
      </article>
    </div>
  );
}
