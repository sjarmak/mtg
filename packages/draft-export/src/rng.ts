/**
 * The draft's random stream: mulberry32 over an FNV-1a seed hash.
 *
 * Thirty lines, no dependency, and identical output for identical seeds on
 * every platform. It is copied rather than shared for the reason
 * `openSealedPool` gives about its own generator: a draft must not draw from
 * the same stream as a game or a sealed pool, and this package depends on
 * `@mtg/deckbuild` and `@mtg/dsl` alone.
 *
 * The state is threaded rather than mutated, so a caller can see exactly which
 * draws a run made. `runDraft` mostly does not thread it at all: every stream a
 * draft uses is named after its position — `seed/pack/2/5`, `seed/pick/2/7/5`
 * — so two runs at one seed agree because each draw asks the same named
 * stream, not because the loop happened to consume one stream in the same
 * order. Reordering the seats cannot move a pick.
 */
export interface Rng {
  readonly state: number;
}

export function createRng(seed: string): Rng {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return { state: hash >>> 0 };
}

function nextFloat(rng: Rng): readonly [number, Rng] {
  const state = (rng.state + 0x6d2b79f5) >>> 0;
  let value = state;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return [((value ^ (value >>> 14)) >>> 0) / 4294967296, { state }];
}

/** A uniform integer in `[0, bound)`. A bound of zero draws nothing. */
export function nextBelow(rng: Rng, bound: number): readonly [number, Rng] {
  if (bound <= 0) return [0, rng];
  const [value, advanced] = nextFloat(rng);
  return [Math.min(bound - 1, Math.floor(value * bound)), advanced];
}
