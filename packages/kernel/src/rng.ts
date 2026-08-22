/**
 * Seeded, purely functional PRNG.
 *
 * `Math.random` is banned in the kernel: every shuffle and coin flip draws from
 * this generator, whose state lives inside `GameState` and is threaded through
 * the reducer like any other field. Same seed plus the same choice sequence
 * therefore replays to a byte-identical event log.
 *
 * Algorithm: sfc32 (Small Fast Counting, 32-bit) seeded by splitmix32 expansion
 * of a FNV-1a hash of the seed string. sfc32 passes PractRand well past the
 * sample sizes a game simulation needs, uses only int32 ops (no BigInt, no
 * float drift), and has a 128-bit state that serializes to four plain numbers.
 */

export interface RngState {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

const UINT32 = 0x1_0000_0000;

/** FNV-1a over UTF-16 code units; deterministic across platforms. */
function hashString(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function splitmix32(state: number): readonly [number, number] {
  const next = (state + 0x9e3779b9) >>> 0;
  let z = next;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  return [(z ^ (z >>> 15)) >>> 0, next];
}

/** Builds a generator state from a string or numeric seed. */
export function createRng(seed: string | number): RngState {
  let scalar = typeof seed === 'number' ? seed >>> 0 : hashString(seed);
  const words: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const [value, nextScalar] = splitmix32(scalar);
    words.push(value);
    scalar = nextScalar;
  }
  const [a = 0, b = 0, c = 0, d = 0] = words;
  // sfc32 needs a short warm-up before its output is well distributed.
  let rng: RngState = { a, b, c, d };
  for (let index = 0; index < 12; index += 1) {
    rng = nextUint32(rng)[1];
  }
  return rng;
}

/** One sfc32 step: the drawn uint32 plus the advanced state. */
export function nextUint32(rng: RngState): readonly [number, RngState] {
  const t = (((rng.a + rng.b) | 0) + rng.d) | 0;
  const d = (rng.d + 1) | 0;
  const a = rng.b ^ (rng.b >>> 9);
  const b = (rng.c + (rng.c << 3)) | 0;
  const rotated = (rng.c << 21) | (rng.c >>> 11);
  const c = (rotated + t) | 0;
  return [t >>> 0, { a, b, c, d }];
}

/**
 * Uniform integer in `[0, bound)` by rejection sampling, so the distribution
 * has no modulo bias and the draw count stays deterministic per seed.
 */
export function nextBelow(rng: RngState, bound: number): readonly [number, RngState] {
  if (!Number.isInteger(bound) || bound <= 0) {
    throw new Error(`nextBelow: bound must be a positive integer, got ${bound}`);
  }
  const limit = UINT32 - (UINT32 % bound);
  let current = rng;
  for (;;) {
    const [value, advanced] = nextUint32(current);
    current = advanced;
    if (value < limit) return [value % bound, current];
  }
}

/** Uniform float in `[0, 1)`. */
export function nextFloat(rng: RngState): readonly [number, RngState] {
  const [value, advanced] = nextUint32(rng);
  return [value / UINT32, advanced];
}

/** Fisher-Yates over a copy; the input array is never touched. */
export function shuffle<T>(items: readonly T[], rng: RngState): readonly [T[], RngState] {
  const result = [...items];
  let current = rng;
  for (let index = result.length - 1; index > 0; index -= 1) {
    const [pick, advanced] = nextBelow(current, index + 1);
    current = advanced;
    const a = result[index];
    const b = result[pick];
    if (a === undefined || b === undefined) continue;
    result[index] = b;
    result[pick] = a;
  }
  return [result, current];
}
