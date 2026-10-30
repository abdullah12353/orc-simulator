import { hashString } from '@orc/content';

// Placeholder portrait art, keyed by the card's `portraitKey`: a masked orc head whose skin, mask and
// tusks vary with the key. The real curated portraits and the overlay compositor arrive with #33.
const SKINS = ['#6b8e23', '#556b2f', '#7c8b3a', '#4f6d3a', '#8a9a5b', '#5f7f4f', '#728c4b', '#64703a'];
const MASKS = ['#3f3f46', '#7f1d1d', '#1e3a5f', '#57534e', '#4c1d95', '#713f12', '#14532d', '#831843'];

export function Portrait({ portraitKey, name, size = 96 }: { portraitKey: string; name: string; size?: number }) {
  const h = hashString(portraitKey);
  const pick = (i: number, n: number) => parseInt(h.slice(i, i + 2), 16) % n;
  const skin = SKINS[pick(0, SKINS.length)];
  const mask = MASKS[pick(2, MASKS.length)];
  const brow = 30 + pick(4, 10);
  const tusk = 6 + pick(6, 8);
  const jaw = 34 + pick(8, 8);

  return (
    <svg className="portrait" width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`${name} (placeholder portrait)`}>
      <rect width="100" height="100" rx="8" fill="#292524" />
      <ellipse cx="50" cy="55" rx={jaw} ry="38" fill={skin} />
      <path d={`M ${50 - jaw + 4} ${brow + 8} Q 50 ${brow - 6} ${50 + jaw - 4} ${brow + 8} L ${50 + jaw - 6} ${brow + 22} Q 50 ${brow + 14} ${50 - jaw + 6} ${brow + 22} Z`} fill={mask} />
      <circle cx="38" cy={brow + 15} r="4" fill="#fde68a" />
      <circle cx="62" cy={brow + 15} r="4" fill="#fde68a" />
      <path d="M 34 72 Q 50 80 66 72" stroke="#1c1917" strokeWidth="3" fill="none" />
      <path d={`M 38 74 l 3 -${tusk} l 3 ${tusk} Z`} fill="#f5f5f4" />
      <path d={`M 56 74 l 3 -${tusk} l 3 ${tusk} Z`} fill="#f5f5f4" />
    </svg>
  );
}
