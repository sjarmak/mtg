/**
 * Largest-remainder (Hamilton) apportionment: hand out `total` indivisible
 * slots in proportion to real-valued weights.
 *
 * Two packages asked the same question and each answered it. `@mtg/deckbuild`
 * splits a land count across colors by pip demand and a creature floor across
 * curve buckets; `@mtg/design-data` scales every derived skeleton count, so a
 * profile scaled down neither loses nor invents a card. mtg-bc2.134 merged the
 * copies here because `@mtg/dsl` is the one package both already depend on —
 * an arrow between the deck builder and the design corpus would be a worse
 * price for one function than a shared primitive in the package that has no
 * dependencies at all and already carries `assertNever` and `canonicalJson`.
 *
 * The copies parted on degenerate input: `@mtg/deckbuild`'s handed back zeros
 * for an empty or all-zero weight vector, `@mtg/design-data`'s refused it. The
 * refusal is what survives, because it is the only version whose postcondition
 * — integers summing to exactly `total` — holds on every input it accepts, and
 * because zeros for a total of seventeen is a wrong answer wearing a right
 * type. Neither package could reach the case: the land split runs on a color
 * pair with an all-ones fallback, the curve split on a non-empty bucket list,
 * and `@mtg/decklab`'s basic split returns before this on `active.length === 0`.
 *
 * Ties on the fractional remainder break by ascending index, so the result is a
 * pure function of the weight vector and two runs agree forever.
 */

export function apportion(total: number, weights: readonly number[]): number[] {
  if (!Number.isInteger(total) || total < 0) {
    throw new RangeError(`apportion: total must be a non-negative integer, got ${total}`);
  }
  if (weights.length === 0) {
    throw new RangeError('apportion: needs at least one weight');
  }
  if (weights.some((weight) => !Number.isFinite(weight) || weight < 0)) {
    throw new RangeError(`apportion: weights must be finite and non-negative, got [${weights.join(', ')}]`);
  }
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightSum <= 0) {
    throw new RangeError('apportion: weights must not all be zero');
  }

  const exact = weights.map((weight) => (total * weight) / weightSum);
  const result = exact.map((share) => Math.floor(share));
  const order = exact
    .map((share, index) => ({ index, remainder: share - Math.floor(share) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  let remaining = total - result.reduce((sum, count) => sum + count, 0);
  for (const { index } of order) {
    if (remaining <= 0) break;
    const current = result[index];
    if (current === undefined) continue;
    result[index] = current + 1;
    remaining -= 1;
  }
  return result;
}
