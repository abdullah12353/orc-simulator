// Writes the PWA's PNG icons (apps/web/public/icons/) from the same mark as icon.svg: a purple tile with a
// white "OS". Dependency-free (shapes + zlib), so it runs anywhere: `node scripts/make-icons.mjs`.
// Android Chrome needs 192/512 PNGs to install; iOS needs a PNG apple-touch-icon (it ignores SVG).
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const PURPLE = [0x93, 0x33, 0xea];
const WHITE = [0xff, 0xff, 0xff];
const STROKE = 0.05;

/** Inside an elliptical ring centred (cx, cy) with radii (rx, ry) and a stroke of STROKE. */
function ring(x, y, cx, cy, rx, ry) {
  const outer = ((x - cx) / (rx + STROKE / 2)) ** 2 + ((y - cy) / (ry + STROKE / 2)) ** 2;
  const inner = ((x - cx) / (rx - STROKE / 2)) ** 2 + ((y - cy) / (ry - STROKE / 2)) ** 2;
  return outer <= 1 && inner >= 1;
}

/** The "OS" glyphs in unit coordinates (0..1 across the icon). */
function glyph(x, y) {
  if (ring(x, y, 0.36, 0.5, 0.115, 0.15)) return true;
  // S: a top bowl open at its lower right, a bottom bowl open at its upper left.
  const sx = 0.64;
  const top = { cy: 0.427, rx: 0.095, ry: 0.073 };
  const bot = { cy: 0.573, rx: 0.095, ry: 0.073 }; // the bowls meet at y = 0.5
  if (ring(x, y, sx, top.cy, top.rx, top.ry) && !(x > sx && y > top.cy - 0.025)) return true;
  if (ring(x, y, sx, bot.cy, bot.rx, bot.ry) && !(x < sx && y < bot.cy + 0.025)) return true;
  return false;
}

/** Inside a rounded square tile (radius r, unit coordinates). */
function tile(x, y, r) {
  const dx = Math.max(r - x, 0, x - (1 - r));
  const dy = Math.max(r - y, 0, y - (1 - r));
  return dx * dx + dy * dy <= r * r;
}

function render(size, { rounded, scale = 1 }) {
  const ss = 4; // 4×4 supersampling
  const px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let inTile = 0;
      let inGlyph = 0;
      for (let a = 0; a < ss; a++) {
        for (let b = 0; b < ss; b++) {
          const x = (i + (a + 0.5) / ss) / size;
          const y = (j + (b + 0.5) / ss) / size;
          if (rounded && !tile(x, y, 14 / 64)) continue;
          inTile++;
          if (glyph(0.5 + (x - 0.5) / scale, 0.5 + (y - 0.5) / scale)) inGlyph++;
        }
      }
      const o = (j * size + i) * 4;
      const t = inGlyph / Math.max(inTile, 1);
      for (let c = 0; c < 3; c++) px[o + c] = Math.round(PURPLE[c] * (1 - t) + WHITE[c] * t);
      px[o + 3] = Math.round((255 * inTile) / (ss * ss));
    }
  }
  return png(size, px);
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let j = 0; j < size; j++) rgba.copy(rows, j * (size * 4 + 1) + 1, j * size * 4, (j + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = new URL('../apps/web/public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
const icons = {
  'icon-192.png': render(192, { rounded: true }),
  'icon-512.png': render(512, { rounded: true }),
  // Maskable: full bleed, the mark shrunk into the 80% safe zone.
  'maskable-512.png': render(512, { rounded: false, scale: 0.8 }),
  // iOS rounds the corners itself and shows transparency as black, so full bleed.
  'apple-touch-icon.png': render(180, { rounded: false }),
};
for (const [name, data] of Object.entries(icons)) writeFileSync(new URL(name, out), data);
console.log(`wrote ${Object.keys(icons).join(', ')} to apps/web/public/icons/`);
