/**
 * The small seeded generator both pack openers draw from.
 *
 * Kept here rather than borrowed from the kernel: the kernel's RNG is game state
 * that shuffles libraries, and opening packs must not share a stream with it.
 * This package depends on nothing but `@mtg/dsl` and that is worth keeping.
 *
 * It sat in `sealed.ts` until `collation.ts` needed the identical stream. One
 * copy rather than two, because two copies of a seeded generator are two chances
 * for one of them to drift, and a drift here is silent: the packs still open,
 * they are simply not the packs the seed names any more.
 */
export interface Rng {
  readonly state: number;
}

export function seedRng(seed: string): Rng {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return { state: hash >>> 0 };
}

export function nextInt(rng: Rng, bound: number): readonly [number, Rng] {
  const mixed = (Math.imul(rng.state ^ (rng.state >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
  return [mixed % bound, { state: mixed }];
}
