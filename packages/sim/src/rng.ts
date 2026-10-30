// The sim's only source of randomness: one sfc32 stream per tick, seeded from hash(world seed, tick_seq).

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly T[], weight: (item: T) => number): T;
}

function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The per-tick seed: hash(world seed, tick_seq). Both inputs are treated as unsigned 32-bit. */
export function tickSeed(worldSeed: number, tickSeq: number): number {
  return fmix32((worldSeed >>> 0) ^ fmix32(Math.imul((tickSeq >>> 0) ^ 0x9e3779b9, 0x27d4eb2f)));
}

export function createRng(seed: number): Rng {
  // splitmix32 expands the 32-bit seed into sfc32's 128-bit state.
  let s = seed >>> 0;
  const split = () => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  };
  let a = split();
  let b = split();
  let c = split();
  let d = split();
  const sfc32 = () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) sfc32();

  const rng: Rng = {
    next: sfc32,
    int: (n) => Math.floor(sfc32() * n),
    chance: (p) => sfc32() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error('rng.pick on an empty list');
      return items[rng.int(items.length)]!;
    },
    weighted: (items, weight) => {
      const total = items.reduce((sum, it) => sum + weight(it), 0);
      if (!(total > 0)) throw new Error('rng.weighted with no positive weight');
      let r = sfc32() * total;
      for (const it of items) {
        r -= weight(it);
        if (r < 0) return it;
      }
      return items[items.length - 1]!;
    },
  };
  return rng;
}
