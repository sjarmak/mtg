/**
 * Seeded pseudo-randomness.
 *
 * Set generation must be reproducible: the same brief seed has to produce a
 * byte-identical slot allocation forever, on every machine, so a set can be
 * regenerated and diffed. `Math.random` is therefore never used anywhere in this
 * package — every non-deterministic-looking choice comes from here.
 *
 * mulberry32 is a 32-bit PRNG with a single-word state; it is not
 * cryptographic, which is exactly right for reproducible design decisions.
 */

/** FNV-1a over the seed string, so any label can seed the generator. */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export type Rng = () => number;

/** mulberry32: returns floats in [0, 1). */
export function createRng(seed: string): Rng {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates over a copy; the input is never mutated. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    const a = copy[index];
    const b = copy[swap];
    if (a === undefined || b === undefined) continue;
    copy[index] = b;
    copy[swap] = a;
  }
  return copy;
}
