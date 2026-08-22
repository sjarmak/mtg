/**
 * Hypergeometric draw probabilities.
 *
 * This is the math behind Frank Karsten's colored-source tables (the ~90%
 * on-curve castability threshold cited in
 * `docs/research/prior-art-playability-metrics.md` §4.4). Computing it directly
 * beats transcribing a table: the deck builder reports the actual probability
 * for the actual deck rather than looking up a bucketed row.
 *
 * Everything is done in log space so the factorials stay finite for pool sizes
 * larger than a 40-card Limited deck.
 */

const LOG_FACTORIAL: number[] = [0];

function logFactorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`logFactorial: n must be a non-negative integer, got ${n}`);
  }
  const known = LOG_FACTORIAL.length - 1;
  if (n > known) {
    let accumulator = LOG_FACTORIAL[known] ?? 0;
    for (let i = known + 1; i <= n; i += 1) {
      accumulator += Math.log(i);
      LOG_FACTORIAL.push(accumulator);
    }
  }
  const value = LOG_FACTORIAL[n];
  if (value === undefined) throw new Error(`logFactorial: cache miss at ${n}`);
  return value;
}

/** log(C(n, k)); -Infinity when the choice is impossible. */
export function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY;
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

/**
 * P(X = successesWanted) for X ~ Hypergeometric(population, successesInPopulation, draws).
 */
export function hypergeometricExact(
  successesWanted: number,
  successesInPopulation: number,
  draws: number,
  population: number,
): number {
  const logNumerator =
    logChoose(successesInPopulation, successesWanted) +
    logChoose(population - successesInPopulation, draws - successesWanted);
  if (logNumerator === Number.NEGATIVE_INFINITY) return 0;
  return Math.exp(logNumerator - logChoose(population, draws));
}

/**
 * The half of the contract both entry points share: an integer ask against an
 * integer deck. `minSourcesFor` is solving for the source count, so it has no
 * `successesInPopulation` to check and cannot call `validate`.
 *
 * An unchecked ask answers a neighboring question in silence: `for (i = 0;
 * i < successesWanted)` sums the exact terms below 2.5 up to and including 2,
 * so 2.5 returns P(X >= 3), and -2 skips the loop for P(X >= 0) = 1.
 */
function validateAsk(successesWanted: number, draws: number, population: number): void {
  if (!Number.isInteger(population) || population < 0) {
    throw new Error(`hypergeometric: population must be a non-negative integer, got ${population}`);
  }
  if (!Number.isInteger(draws) || draws < 0) {
    throw new Error(`hypergeometric: draws must be a non-negative integer, got ${draws}`);
  }
  if (!Number.isInteger(successesWanted) || successesWanted < 0) {
    throw new Error(`hypergeometric: successesWanted must be a non-negative integer, got ${successesWanted}`);
  }
}

function validate(
  successesWanted: number,
  successesInPopulation: number,
  draws: number,
  population: number,
): void {
  validateAsk(successesWanted, draws, population);
  if (!Number.isInteger(successesInPopulation) || successesInPopulation < 0) {
    throw new Error(
      `hypergeometric: successesInPopulation must be a non-negative integer, got ${successesInPopulation}`,
    );
  }
  if (successesInPopulation > population) {
    throw new Error(
      `hypergeometric: successesInPopulation ${successesInPopulation} exceeds population ${population}`,
    );
  }
}

/**
 * P(X >= successesWanted): the chance of seeing at least that many sources in
 * `draws` cards off the top of a `population`-card deck. `draws` above the
 * population is clamped, which is what happens in a real game that decks out.
 */
export function hypergeometricAtLeast(
  successesWanted: number,
  successesInPopulation: number,
  draws: number,
  population: number,
): number {
  validate(successesWanted, successesInPopulation, draws, population);
  if (successesWanted === 0) return 1;
  const seen = Math.min(draws, population);
  if (successesWanted > Math.min(successesInPopulation, seen)) return 0;

  let below = 0;
  for (let i = 0; i < successesWanted; i += 1) {
    below += hypergeometricExact(i, successesInPopulation, seen, population);
  }
  return Math.min(1, Math.max(0, 1 - below));
}

/**
 * The fewest sources that make `hypergeometricAtLeast` reach `target`.
 *
 * This is the same question a Karsten table answers, asked the way a deck
 * builder has to ask it: not "how likely is this mana base" but "how many
 * sources does this color need". Castability is a threshold rather than a
 * proportion — a color whose cheapest card costs {1}{B} needs fifteen sources
 * in a sixty-card deck however small its share of the deck's pips is — and a
 * split that cannot express a floor cannot meet one.
 *
 * The probability rises with the source count, so the first count that clears
 * the target is the smallest that does and the scan is its own proof. An
 * unreachable target throws: it means more successes were wanted than there are
 * cards to draw, which no mana base can fix and which is a caller bug rather
 * than a shortfall.
 */
export function minSourcesFor(
  successesWanted: number,
  target: number,
  draws: number,
  population: number,
): number {
  if (!Number.isFinite(target) || target <= 0 || target > 1) {
    throw new Error(`minSourcesFor: target must be in (0, 1], got ${target}`);
  }
  validateAsk(successesWanted, draws, population);
  // min(draws, population) is the ceiling `hypergeometricAtLeast` clamps to, and
  // it does not mention the source count: an ask above it fails at every one of
  // the population + 1 candidates alike, so scanning cannot change the verdict.
  if (successesWanted > Math.min(draws, population)) {
    throw new Error(
      `minSourcesFor: no source count reaches ${target} for ${successesWanted} of ${draws} cards drawn from ${population}`,
    );
  }
  for (let sources = 0; sources <= population; sources += 1) {
    if (hypergeometricAtLeast(successesWanted, sources, draws, population) >= target) return sources;
  }
  // Unreachable: past the guard, `population` sources meet the ask with
  // probability exactly 1 and the target is at most 1.
  throw new Error(
    `minSourcesFor: ${population} sources did not reach ${target} for ${successesWanted} of ${draws} cards drawn`,
  );
}
