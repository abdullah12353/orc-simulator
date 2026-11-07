import { useEffect, useState } from 'react';
import { gutterNotice, type GutterNotice as Notice } from './gutter.ts';

// The usage guard's banner (#70), asked for once each time a world opens. Until #69 sets VITE_WORKER_URL
// there's no Worker to ask, so it shows nothing; nor on a failed fetch.
const WORKER_URL = ((import.meta.env.VITE_WORKER_URL as string | undefined) ?? '').trim().replace(/\/+$/, '');

export function GutterNotice() {
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
  if (!notice) return null;
  return (
    <p className="gutter" role="status">
      {notice.line} <span className="quiet">{notice.more}</span>
    </p>
  );
}
