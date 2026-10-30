// A Clipping as a shareable image (#41): the snapshot drawn onto a 1080×1350 canvas (portraits through the
// shared compositor's <Portrait>, rasterised from its SVG), then shared through the Web Share API with the
// PNG attached, or downloaded where sharing files isn't supported. Not checked by hand in a browser.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ClippingSnapshot } from '@orc/sim';
import { clippingFileName, wrapText } from './clipping-layout.ts';
import { Portrait } from './Portrait.tsx';

const W = 1080;
const H = 1350;
const PAD = 72;
const PAPER = '#f3ecd9';
const INK = '#1c1917';
const SERIF = 'Georgia, "Times New Roman", serif';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Inlines every `href` in an SVG as a data URL: an SVG drawn as an image can't fetch anything itself. */
async function inlineHrefs(svg: string): Promise<string> {
  const hrefs = [...new Set([...svg.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!))].filter((h) => !h.startsWith('data:'));
  let out = svg;
  for (const href of hrefs) {
    try {
      const blob = await (await fetch(href)).blob();
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
      out = out.split(`href="${href}"`).join(`href="${data}"`);
    } catch {
      // A missing layer is left out rather than spoiling the whole card.
    }
  }
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('a portrait would not draw'));
    img.src = src;
  });
}

async function portraitImage(p: ClippingSnapshot['portraits'][number], size: number): Promise<HTMLImageElement> {
  let svg = renderToStaticMarkup(createElement(Portrait, { face: p.face, name: p.name, size }));
  if (!svg.includes('xmlns=')) svg = svg.replace('<svg', `<svg xmlns="${SVG_NS}"`);
  svg = await inlineHrefs(svg);
  return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}

/** Draws wrapped text from `y`; returns the y below it. */
function paragraph(ctx: CanvasRenderingContext2D, text: string, y: number, font: string, lineHeight: number, align: CanvasTextAlign = 'left'): number {
  ctx.font = font;
  ctx.textAlign = align;
  const x = align === 'center' ? W / 2 : PAD;
  for (const line of wrapText(text, W - 2 * PAD, (s) => ctx.measureText(s).width)) {
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
  return y;
}

const nameOf = (snap: ClippingSnapshot, id: string) => snap.portraits.find((p) => p.captainId === id)?.name ?? id;

/** The Clipping as a PNG. */
export async function clippingImage(snap: ClippingSnapshot): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw the Clipping.');
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = INK;
  ctx.textBaseline = 'alphabetic';

  // Masthead.
  let y = paragraph(ctx, 'The Gutter Herald', PAD + 40, `900 64px ${SERIF}`, 72, 'center');
  if (snap.edition) y = paragraph(ctx, `${snap.edition.orcDate} · No. ${snap.edition.no}`, y - 10, `italic 28px ${SERIF}`, 36, 'center');
  ctx.fillRect(PAD, y, W - 2 * PAD, 4);
  y += 70;

  // Headline.
  y = paragraph(ctx, snap.headline, y, `bold 56px ${SERIF}`, 64);
  y += 16;

  // Portraits, side by side, as they were when clipped.
  const n = snap.portraits.length;
  if (n > 0) {
    const size = n === 1 ? 380 : 340;
    const gap = (W - n * size) / (n + 1);
    const images = await Promise.all(snap.portraits.map((p) => portraitImage(p, size).catch(() => null)));
    const h = (size * 640) / 512;
    images.forEach((img, i) => {
      const x = gap + i * (size + gap);
      if (img) ctx.drawImage(img, x, y, size, h);
      ctx.font = `bold 30px ${SERIF}`;
      ctx.textAlign = 'center';
      ctx.fillText(snap.portraits[i]!.name, x + size / 2, y + h + 40);
    });
    y += h + 90;
  }

  if (snap.pullQuote) {
    y = paragraph(ctx, `“${snap.pullQuote.text}”`, y, `italic 40px ${SERIF}`, 50);
    y = paragraph(ctx, `— ${snap.pullQuote.name}`, y, `28px ${SERIF}`, 40);
    y += 10;
  }
  if (snap.trophy) {
    const t = snap.trophy;
    y = paragraph(ctx, `Trophy: ${nameOf(snap, t.to)} took ${nameOf(snap, t.from)}'s ${t.text}.`, y, `26px ${SERIF}`, 36);
  }
  if (snap.blameLine) paragraph(ctx, snap.blameLine, Math.max(y + 10, H - PAD - 60), `italic 26px ${SERIF}`, 34);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The Clipping would not print.'))), 'image/png'));
}

/** Shares the Clipping's image (Web Share API, with the file), else downloads it. */
export async function shareClipping(snap: ClippingSnapshot): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = await clippingImage(snap);
  const name = clippingFileName(snap);
  const file = new File([blob], name, { type: 'image/png' });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: snap.headline, text: snap.headline });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // Anything else (no permission, a flaky share sheet): fall through to a download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
