// A story's templated Blame line (#29), shared by the Herald and the Clash card.
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A story's Blame line (templated, #29) with the reader's own name highlighted. Names are unique per
 * world, so a whole-word match on mine is enough ("Mo" never lights up inside "Moira").
 */
export function BlameLine({ line, reader }: { line: string; reader: string }) {
  if (!reader) return <p className="blame">{line}</p>;
  const mine = new RegExp(`(?<![\\p{L}\\p{N}])(${escapeRegExp(reader)})(?![\\p{L}\\p{N}])`, 'giu');
  const parts = line.split(mine);
  return (
    <p className="blame">
      {parts.map((part, i) => (i % 2 === 1 ? <mark key={i} className="me">{part}</mark> : part))}
    </p>
  );
}

