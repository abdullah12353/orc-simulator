import type { ReactNode } from 'react';
import { LEGENDARY_LAYER, PORTRAIT_TEMPLATE, composePortrait, content, hashString, type ComposedPortrait, type PortraitLayer } from '@orc/content';

// The portrait compositor (#18, #33): a base portrait and its overlays, all drawn to the one shared
// template face box, stacked in the order `composePortrait` (@orc/content) decides. With
// VITE_PORTRAIT_ART=webp it layers the curated lossy WebPs (`portraits/<key>.webp` and
// `portraits/overlays/<kind>.webp`, 512×640); until those exist it draws placeholder art, keyed by the
// portrait key and by Humiliation kind. Used on Captain cards, Clash cards and Introductions (and #41's
// Clippings).

const W = 200;
const H = (W * PORTRAIT_TEMPLATE.height) / PORTRAIT_TEMPLATE.width; // 250
/** Template pixels (512 wide) to this drawing's units. */
const UNIT = W / PORTRAIT_TEMPLATE.width;
const WEBP = import.meta.env.VITE_PORTRAIT_ART === 'webp';

/** A Captain with nothing on his face (no Humiliations). */
export const bareFace = (captainId: string): ComposedPortrait => composePortrait(content, { captainId, marks: [] });

export function Portrait({ face, name, size = 96 }: { face: ComposedPortrait; name: string; size?: number }) {
  const shown = face.layers.filter((l) => l.key !== LEGENDARY_LAYER).map((l) => l.key);
  const label = shown.length
    ? `${name}, with ${shown.map((k) => content.banks.humiliations[k]?.label ?? k).join(', ')}`
    : name;
  const art = (layer: PortraitLayer, placeholder: ReactNode) =>
    WEBP ? <image href={`${import.meta.env.BASE_URL}${layer.src}`} width={W} height={H} /> : placeholder;
  return (
    <svg className="portrait" width={size} height={(size * H) / W} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {WEBP ? (
        <image href={`${import.meta.env.BASE_URL}${face.base}`} width={W} height={H} />
      ) : (
        <PlaceholderBase portraitKey={face.portraitKey} tuskless={face.layers.some((l) => l.key === 'lost.tusk')} />
      )}
      {face.layers.map((layer) => (
        <g key={layer.key} transform={nudge(layer)}>
          {art(layer, <PlaceholderOverlay kind={layer.key} />)}
        </g>
      ))}
    </svg>
  );
}

/** A card's sparse face-box override for one layer, as an SVG transform (scale about the centre). */
function nudge(layer: PortraitLayer): string | undefined {
  const n = layer.nudge;
  if (!n) return undefined;
  const s = n.scale ?? 1;
  const x = (n.x ?? 0) * UNIT;
  const y = (n.y ?? 0) * UNIT;
  return `translate(${x + (W / 2) * (1 - s)} ${y + (H / 2) * (1 - s)}) scale(${s})`;
}

// ---- Placeholder art, on the template face box (crown 40, eye line 96, mouth line 142, half-width 64).
const CX = 100;
const BOX = { crownY: 40, eyeY: 96, eyeDX: 26, mouthY: 142, mouthW: 32, hw: 64, jaw: 62, chinY: 172 };
const SKINS = ['#6b8e23', '#556b2f', '#7c8b3a', '#4f6d3a', '#8a9a5b', '#5f7f4f', '#728c4b', '#64703a'];
const GEAR = ['#3f3f46', '#7f1d1d', '#1e3a5f', '#57534e', '#4c1d95', '#713f12', '#14532d', '#831843'];

/** A masked orc bust whose skin, gear, ears and jaw vary with the key; identity lives outside the face box. */
function PlaceholderBase({ portraitKey, tuskless }: { portraitKey: string; tuskless: boolean }) {
  const h = hashString(portraitKey);
  const pick = (i: number, n: number) => parseInt(h.slice(i, i + 2), 16) % n;
  const skin = SKINS[pick(0, SKINS.length)];
  const gear = GEAR[pick(2, GEAR.length)];
  const ear = 14 + pick(4, 14);
  const jaw = BOX.jaw - 6 + pick(6, 14);
  const tusk = 12 + pick(8, 8);
  const { eyeY, eyeDX, mouthY, mouthW, crownY, hw, chinY } = BOX;
  const tx = Math.round(mouthW * 0.7);
  return (
    <g>
      <rect width={W} height={H} rx="10" fill="#292524" />
      <path d={`M 20 ${H} Q 30 205 ${CX} 200 Q 170 205 180 ${H} Z`} fill={gear} />
      <path d={`M ${CX - hw} ${eyeY} l -${ear} -10 l 6 ${ear + 6} Z M ${CX + hw} ${eyeY} l ${ear} -10 l -6 ${ear + 6} Z`} fill={skin} />
      <path
        d={`M ${CX - hw} ${crownY + 30} Q ${CX} ${crownY - 26} ${CX + hw} ${crownY + 30} L ${CX + jaw} ${mouthY + 6} Q ${CX} ${chinY + 22} ${CX - jaw} ${mouthY + 6} Z`}
        fill={skin}
      />
      <path d={`M ${CX - hw + 6} ${eyeY - 14} Q ${CX} ${eyeY - 30} ${CX + hw - 6} ${eyeY - 14} L ${CX + hw - 8} ${eyeY + 10} Q ${CX} ${eyeY} ${CX - hw + 8} ${eyeY + 10} Z`} fill={gear} />
      <circle cx={CX - eyeDX} cy={eyeY} r="5" fill="#fde68a" />
      <circle cx={CX + eyeDX} cy={eyeY} r="5" fill="#fde68a" />
      <path d={`M ${CX - 6} ${eyeY + 22} l 6 6 l 6 -6`} stroke="#1c1917" strokeWidth="3" fill="none" />
      <path d={`M ${CX - mouthW} ${mouthY} Q ${CX} ${mouthY + 12} ${CX + mouthW} ${mouthY}`} stroke="#1c1917" strokeWidth="4" fill="none" />
      {!tuskless && <path d={`M ${CX - tx - 4} ${mouthY + 4} l 4 -${tusk} l 4 ${tusk} Z`} fill="#f5f5f4" />}
      <path d={`M ${CX + tx - 4} ${mouthY + 4} l 4 -${tusk} l 4 ${tusk} Z`} fill="#f5f5f4" />
    </g>
  );
}

const BANDAGE = '#d6d3c4';
const STITCH = '#8b8577';

/** One placeholder overlay per Humiliation kind, drawn once for the face box. */
function PlaceholderOverlay({ kind }: { kind: string }) {
  const { eyeY, eyeDX, mouthY, mouthW, crownY, hw } = BOX;
  switch (kind) {
    case 'lost.tusk':
      return <path d={`M ${CX - 26} ${mouthY + 4} l 3 -5 l 3 2 l 2 3 Z`} fill="#e7e5e4" stroke="#57534e" />;
    case 'lost.ear':
      return (
        <g>
          <rect x={CX - hw - 18} y={eyeY - 12} width="22" height="22" fill="#292524" />
          <path d={`M ${CX - hw - 12} ${eyeY - 8} l 18 16 M ${CX - hw + 6} ${eyeY - 8} l -18 16`} stroke={BANDAGE} strokeWidth="5" />
        </g>
      );
    case 'lost.peg-leg':
      return (
        <g>
          <circle cx="30" cy="222" r="18" fill="#78350f" stroke="#fde68a" strokeWidth="2" />
          <rect x="26" y="210" width="8" height="24" rx="3" fill="#d6b98c" />
        </g>
      );
    case 'lost.hook':
      return <path d="M 160 238 L 160 214 Q 160 198 174 198 Q 186 198 186 210" stroke="#a8a29e" strokeWidth="6" fill="none" strokeLinecap="round" />;
    case 'disguise.moustache':
      return (
        <g>
          <path d={`M ${CX} ${mouthY - 12} q -20 -6 -38 6 q 14 -2 38 6 q 24 -8 38 -6 q -18 -12 -38 -6 Z`} fill="#3b2a1a" />
          <path d={`M ${CX + 40} ${mouthY - 6} l 14 10`} stroke="#fde68a" strokeWidth="1.5" />
          <rect x={CX + 52} y={mouthY + 2} width="16" height="9" fill="#fde68a" />
        </g>
      );
    case 'bandage.mouth':
      return (
        <g>
          <rect x={CX - mouthW - 14} y={mouthY - 10} width={2 * mouthW + 28} height="22" rx="4" fill={BANDAGE} />
          <path d={`M ${CX - 20} ${mouthY - 6} l 8 14 M ${CX - 4} ${mouthY - 6} l 8 14 M ${CX + 12} ${mouthY - 6} l 8 14`} stroke={STITCH} strokeWidth="2" />
        </g>
      );
    case 'bandage.eyepatch':
      // Over the wrong eye, naturally.
      return (
        <g>
          <path d={`M ${CX - hw} ${eyeY - 22} L ${CX + hw} ${eyeY + 8}`} stroke="#0c0a09" strokeWidth="3" />
          <ellipse cx={CX + eyeDX} cy={eyeY} rx="13" ry="11" fill="#0c0a09" />
        </g>
      );
    case 'bandage.head':
      return (
        <g>
          <path d={`M ${CX - hw - 2} ${crownY + 34} Q ${CX} ${crownY + 14} ${CX + hw + 2} ${crownY + 34} L ${CX + hw} ${crownY + 50} Q ${CX} ${crownY + 30} ${CX - hw} ${crownY + 50} Z`} fill={BANDAGE} />
          <path d={`M ${CX + hw} ${crownY + 40} l 18 10 l -4 8 Z`} fill={BANDAGE} />
          <circle cx={CX - 20} cy={crownY + 36} r="4" fill="#991b1b" opacity="0.7" />
        </g>
      );
    case 'bandage.mummy':
      return (
        <g stroke={BANDAGE} strokeWidth="11" opacity="0.92">
          <path d={`M ${CX - hw} ${crownY + 30} L ${CX + hw} ${crownY + 50}`} />
          <path d={`M ${CX - hw} ${eyeY + 16} L ${CX + hw} ${eyeY - 4}`} />
          <path d={`M ${CX - hw + 4} ${mouthY - 8} L ${CX + hw - 4} ${mouthY + 10}`} />
          <path d={`M ${CX - hw + 14} ${mouthY + 22} L ${CX + hw - 14} ${mouthY + 18}`} />
        </g>
      );
    case 'disguise.wig':
      return (
        <path
          d={`M ${CX - hw - 8} ${eyeY - 6} Q ${CX - hw - 20} ${crownY - 20} ${CX} ${crownY - 22} Q ${CX + hw + 20} ${crownY - 20} ${CX + hw + 8} ${eyeY - 6} Q ${CX + 40} ${crownY + 8} ${CX} ${crownY + 12} Q ${CX - 40} ${crownY + 8} ${CX - hw - 8} ${eyeY - 6} Z`}
          fill="#facc15"
          stroke="#a16207"
          strokeWidth="3"
          strokeDasharray="6 3"
        />
      );
    case 'disguise.bucket':
      return (
        <g>
          <path d={`M ${CX - hw + 4} ${crownY - 22} L ${CX + hw - 4} ${crownY - 22} L ${CX + hw + 10} ${eyeY - 12} L ${CX - hw - 10} ${eyeY - 12} Z`} fill="#71717a" stroke="#3f3f46" strokeWidth="3" />
          <path d={`M ${CX - hw + 4} ${crownY - 22} Q ${CX} ${crownY - 46} ${CX + hw - 4} ${crownY - 22}`} stroke="#a1a1aa" strokeWidth="3" fill="none" />
          <rect x={CX - 30} y={eyeY - 26} width="60" height="6" rx="3" fill="#18181b" />
        </g>
      );
    case LEGENDARY_LAYER:
      return (
        <g transform={`rotate(-12 150 30)`}>
          <rect x="104" y="14" width="92" height="30" rx="4" fill="none" stroke="#eab308" strokeWidth="4" />
          <text x="150" y="35" textAnchor="middle" fontSize="15" fontWeight="900" fill="#eab308" fontFamily="Impact, sans-serif">
            LEGENDARY
          </text>
        </g>
      );
    default:
      // A kind with no placeholder yet: a labelled plaster, so it's never invisible.
      return (
        <g>
          <rect x="8" y={H - 30} width={W - 16} height="22" rx="4" fill={BANDAGE} />
          <text x={CX} y={H - 14} textAnchor="middle" fontSize="11" fill="#292524">
            {content.banks.humiliations[kind]?.label ?? kind}
          </text>
        </g>
      );
  }
}
