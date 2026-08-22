/**
 * Deck construction with the color pair chosen for you.
 *
 * `buildDeck` picks its own colors, which is what you want when the question
 * is "what is the best deck this pool supports". It is the wrong shape when the
 * question is "how does each archetype perform", because a round-robin whose
 * builder silently drifted to a different pair would mislabel every win rate it
 * went on to measure.
 *
 * Forcing the pair by narrowing the pool keeps one construction code path. The
 * alternative — a second, measurement-only builder — is how a harness ends up
 * grading cards it never actually assembled into a deck.
 */
import type { Card } from '@mtg/dsl';
import type { ColorPair } from './color-pair';
import { colorPairKey, isPlayableIn } from './color-pair';
import type { DeckBuildResult } from './build';
import { buildDeck } from './build';
import type { DeckBuildConfigInput } from './config';

/** Thrown when a pool cannot produce a deck in the requested pair. */
export class PairDeckError extends Error {
  readonly pair: ColorPair;

  constructor(pair: ColorPair, message: string) {
    super(message);
    this.name = 'PairDeckError';
    this.pair = pair;
  }
}

/**
 * Builds the best deck `pool` supports in `pair`.
 *
 * Throws `PairDeckError` when no card in the pool is playable in the pair, or
 * when the underlying builder returns a different pair than the one requested
 * (which would mean the narrowing and the ranking disagree about playability).
 */
export function buildDeckForPair(
  pool: readonly Card[],
  pair: ColorPair,
  input: DeckBuildConfigInput = {},
): DeckBuildResult {
  const key = colorPairKey(pair);
  const narrowed = pool.filter((card) => isPlayableIn(card, pair));
  if (narrowed.length === 0) {
    throw new PairDeckError(pair, `no card in the pool of ${pool.length} is playable in ${key}`);
  }

  const result = buildDeck(narrowed, input);

  const chosen = colorPairKey(result.colorPair);
  if (chosen !== key) {
    throw new PairDeckError(
      pair,
      `given only ${key} playables the builder chose ${chosen}; narrowing and color-pair ranking disagree`,
    );
  }
  return result;
}
