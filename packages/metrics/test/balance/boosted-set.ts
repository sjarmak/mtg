/**
 * The committed set, deformed until a gate has to reject it.
 *
 * Two files need a pool that fails: `broken-set.test.ts`, which proves the
 * measurement reports a bad pool as bad, and `gate-wiring.test.ts`, which
 * proves the gate measures the pool it was pointed at rather than the one
 * welded into it. Both want the same deformation, so it lives here instead of
 * in whichever file was written first.
 *
 * The deformation is stated in code rather than committed as a second 90-card
 * fixture, because a hand-written broken set is a second thing to maintain and
 * its brokenness is a matter of opinion. This one is a one-line change to a set
 * that passes: every red creature gets `+POWER_BOOST/+POWER_BOOST` and nothing
 * else moves, which keeps every comparison against it controlled. Same harness,
 * same seed, same volume, same bands, one pool boosted and one not.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** Enough to make a common red creature unanswerable, and nothing subtler. */
export const POWER_BOOST = 6;

interface RawSetFile {
  readonly cards: readonly Record<string, unknown>[];
}

/** Writes the source set out again with every red creature boosted. Returns how many. */
export function writeBoostedSet(sourcePath: string, targetPath: string): number {
  const raw = JSON.parse(readFileSync(sourcePath, 'utf8')) as RawSetFile;
  let boosted = 0;
  const cards = raw.cards.map((card) => {
    const colors = card['colors'];
    const power = card['power'];
    const toughness = card['toughness'];
    if (
      card['kind'] !== 'creature' ||
      !Array.isArray(colors) ||
      !colors.includes('R') ||
      typeof power !== 'number' ||
      typeof toughness !== 'number'
    ) {
      return card;
    }
    boosted += 1;
    return { ...card, power: power + POWER_BOOST, toughness: toughness + POWER_BOOST };
  });
  writeFileSync(targetPath, JSON.stringify({ ...raw, cards }), 'utf8');
  return boosted;
}
