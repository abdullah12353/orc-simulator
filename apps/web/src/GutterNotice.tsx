import { useEffect, useState } from 'react';
import { gutterNotice, type GutterNotice as Notice } from './gutter.ts';

// The usage guard's banner (#70), asked for once each time a world opens. With no VITE_WORKER_URL there's
// no Worker to ask, so it shows nothing; nor on a failed fetch. `closed`: the world's live socket was
// refused with 4013 (#69), which says the same as a `closed` answer.
const WORKER_URL = ((import.meta.env.VITE_WORKER_URL as string | undefined) ?? '').trim().replace(/\/+$/, '');

export function GutterNotice({ closed = false }: { closed?: boolean }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    if (!WORKER_URL) return;
    let cancelled = false;
    void fetch(`${WORKER_URL}/gutter`)
      .then((r) => (r.ok ? r.json() : null))
      .then((answer: unknown) => !cancelled && setNotice(gutterNotice(answer)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const shown = closed ? gutterNotice({ state: 'closed' }) : notice;
  if (!shown) return null;
  return (
    <p className="gutter" role="status">
      {shown.line} <span className="quiet">{shown.more}</span>
    </p>
  );
}
