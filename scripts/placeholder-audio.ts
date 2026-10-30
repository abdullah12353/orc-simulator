// Writes the placeholder audio bank into apps/web/public: one short synthesised grunt per Captain and
// emotion (pitched per Captain, so each sounds like "himself"), his Introduction clips (#33: a drawn-out
// shout of his name and each alias, and a mumbled signature line), the announcer's stingers and one flat
// drone per Epithet. Tiny 8 kHz 8-bit mono WAVs. Deterministic: re-running gives identical files. The real
// ElevenLabs renders (#19) replace these file for file; `--missing` only writes files that don't exist yet,
// so it never clobbers one.
//   node --experimental-strip-types scripts/placeholder-audio.ts [--missing]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  BARK_EMOTIONS,
  STINGERS,
  barkPath,
  content,
  epithetPath,
  hashString,
  introShoutPath,
  introSignaturePath,
  stingerPath,
  type BarkEmotion,
  type Stinger,
} from '@orc/content';

const RATE = 8000;
const PUBLIC = join(import.meta.dirname, '..', 'apps', 'web', 'public');
const onlyMissing = process.argv.includes('--missing');

function wav(samples: Float32Array): Buffer {
  const data = Buffer.alloc(samples.length);
  for (let i = 0; i < samples.length; i++) data[i] = Math.max(0, Math.min(255, Math.round(128 + 127 * samples[i]!)));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** A seeded noise source, so files are byte-identical on every run. */
function noise(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

/** A grunt: a buzzy tone with a pitch contour and an envelope. `pitch(t)` and `amp(t)` take t in 0..1. */
function voice(seconds: number, pitch: (t: number) => number, amp: (t: number) => number, seed: number): Float32Array {
  const n = Math.round(seconds * RATE);
  const out = new Float32Array(n);
  const rnd = noise(seed);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    phase += pitch(t) / RATE;
    const saw = 2 * (phase % 1) - 1;
    const growl = 0.25 * rnd();
    out[i] = 0.6 * amp(t) * (0.75 * saw + growl);
  }
  return out;
}

const envelope = (t: number) => Math.min(1, t * 12) * Math.min(1, (1 - t) * 5);

function bark(captainId: string, emotion: BarkEmotion): Float32Array {
  const h = parseInt(hashString(captainId).slice(0, 8), 16);
  const base = 70 + (h % 90); // 70–160 Hz: each Captain has his own pitch
  const seed = h ^ parseInt(hashString(emotion).slice(0, 8), 16);
  switch (emotion) {
    case 'taunt':
      return voice(0.4, (t) => base * (1.3 - 0.4 * t), envelope, seed);
    case 'oi':
      return voice(0.35, (t) => base * 1.6, (t) => (t < 0.4 || t > 0.55 ? envelope(t) : 0), seed);
    case 'triumph':
      return voice(0.5, (t) => base * (0.9 + 0.8 * t), envelope, seed);
    case 'pain':
      return voice(0.45, (t) => base * (1.5 - 0.7 * t) * (1 + 0.08 * Math.sin(t * 60)), envelope, seed);
    case 'scared':
      return voice(0.4, (t) => base * 2.2 * (1 + 0.15 * Math.sin(t * 90)), envelope, seed);
  }
}

function stinger(name: Stinger): Float32Array {
  const rnd = noise(parseInt(hashString(name).slice(0, 8), 16));
  const seconds = { clash: 1.0, crash: 0.5, verdict: 0.9, trophy: 0.5, intro: 0.8, fanfare: 1.4 }[name];
  const n = Math.round(seconds * RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = i / RATE;
    let v = 0;
    if (name === 'clash') {
      // Three drum hits.
      for (const at of [0, 0.18, 0.36]) {
        const d = s - at;
        if (d >= 0) v += Math.sin(2 * Math.PI * (60 + 80 * Math.exp(-d * 12)) * d) * Math.exp(-d * 9);
      }
    } else if (name === 'crash') {
      v = rnd() * Math.exp(-s * 7); // a smash
    } else if (name === 'verdict') {
      v = (2 * ((s * 98) % 1) - 1) * Math.min(1, s * 10) * Math.exp(-s * 2.5); // a horn
    } else if (name === 'fanfare') {
      // A Legendary deed (#34): three rising horn blasts, the last one held.
      const note = s < 0.3 ? 196 : s < 0.6 ? 262 : 330;
      v = (2 * ((s * note) % 1) - 1) * 0.7 * Math.min(1, ((s % 0.3) + 0.01) * 20) * (s < 0.6 ? 1 : Math.exp(-(s - 0.6) * 2));
    } else if (name === 'intro') {
      // A cymbal swell into a thud: "Ladies and gentlemen…"
      v = s < 0.55 ? rnd() * 0.6 * (s / 0.55) : Math.sin(2 * Math.PI * 55 * (s - 0.55)) * Math.exp(-(s - 0.55) * 8);
    } else {
      v = Math.sin(2 * Math.PI * (500 + 900 * s) * s) * Math.exp(-s * 6); // a rising ting
    }
    out[i] = 0.7 * Math.max(-1, Math.min(1, v));
  }
  return out;
}

/** His Introduction shout: a long, wobbling bellow that rises then collapses. Each alias is pitched a bit off. */
function shout(captainId: string, variant: number): Float32Array {
  const h = parseInt(hashString(captainId).slice(0, 8), 16);
  const base = (70 + (h % 90)) * (1 + 0.12 * variant);
  const seed = h ^ (0x51ab + variant);
  return voice(0.55, (t) => base * (1.2 + 0.6 * Math.sin(Math.PI * t)) * (1 + 0.05 * Math.sin(t * 70)), envelope, seed);
}

/** His signature line: three mumbled "syllables" at his pitch. */
function signature(captainId: string): Float32Array {
  const h = parseInt(hashString(captainId).slice(0, 8), 16);
  const base = 70 + (h % 90);
  return voice(0.8, (t) => base * (1 + 0.25 * Math.sin(t * 19)), (t) => envelope(t) * (0.5 + 0.5 * Math.abs(Math.sin(t * 3 * Math.PI))), h ^ 0x5161);
}

/** The announcer's Epithet: a flat, deadpan drone. */
function epithetClip(key: string): Float32Array {
  const h = parseInt(hashString(key).slice(0, 8), 16);
  return voice(0.6, () => 98, (t) => envelope(t) * (0.6 + 0.4 * Math.abs(Math.sin(t * 2 * Math.PI))), h);
}

let written = 0;
function write(path: string, samples: Float32Array) {
  const file = join(PUBLIC, path);
  if (onlyMissing && existsSync(file)) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, wav(samples));
  written++;
}

for (const card of content.cast) for (const emotion of BARK_EMOTIONS) write(barkPath(card.id, emotion), bark(card.id, emotion));
for (const card of content.cast) {
  write(introShoutPath(card.id), shout(card.id, 0));
  write(introShoutPath(card.id, 0), shout(card.id, 1));
  write(introShoutPath(card.id, 1), shout(card.id, 2));
  write(introSignaturePath(card.id), signature(card.id));
}
for (const name of STINGERS) write(stingerPath(name), stinger(name));
for (const key of Object.keys(content.banks.epithets)) write(epithetPath(key), epithetClip(key));
console.log(`Placeholder audio: wrote ${written} file(s) under ${PUBLIC}`);
