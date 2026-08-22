/**
 * `SimpleBot`: the whole of a custom set's draft intelligence, in one line.
 *
 * ADR-0003 §1 records the algorithm, read from Draftmancer's `src/Bot.ts` via
 * `docs/research/prior-art-tooling.md` §1.1:
 *
 *     score = card.rating + 0.35 x (already-picked cards in each of its colors)
 *
 * argmax, with a random tie-break. A generated set is always drafted by this
 * bot — `fallbackToSimpleBots()` returns true whenever a custom card lacks an
 * oracle id, which for our cards is all of them — so this is the pick function
 * the emitted file will meet, and this module is a mirror of it rather than a
 * bot of our own.
 *
 * Mirror, not import: nothing here has run against a Draftmancer. ADR-0003 §3
 * is the checklist for the first real import, and this file adds one row to
 * what that import has to check — that these picks are the picks Draftmancer
 * makes. The one thing kept deliberately identical is the constant: the bonus
 * comes from `SIMPLE_BOT_COLOR_BONUS` in `rating.ts`, the same number the
 * rating band is measured in, so the two cannot drift apart in this repo and a
 * disagreement with Draftmancer can only be Draftmancer's number changing.
 *
 * The bonus is summed over *each* of a card's colors, so a gold card in a
 * two-color pile is worth two counts, and a colorless card is worth none. That
 * is the source's `for (const color of card.colors)`, and it is why an artifact
 * has to be good on its rating alone.
 */
import type { Card, Color } from '@mtg/dsl';
import { DraftError } from './errors';
import type { CardRating } from './rating';
import { SIMPLE_BOT_COLOR_BONUS } from './rating';
import type { Rng } from './rng';
import { nextBelow } from './rng';

export type ColorCounts = Readonly<Record<Color, number>>;

const NO_COLORS: ColorCounts = { W: 0, U: 0, B: 0, R: 0, G: 0 };

/** Cards already picked, counted per color. A gold card counts in both. */
export function countPickedColors(picked: readonly Card[]): ColorCounts {
  const counts: Record<Color, number> = { ...NO_COLORS };
  for (const card of picked) {
    for (const color of card.colors) counts[color] += 1;
  }
  return counts;
}

/** One card's score to a bot holding `picked`: its rating plus color affinity. */
export function simpleBotScore(rated: CardRating, picked: ColorCounts): number {
  return rated.card.colors.reduce(
    (score, color) => score + SIMPLE_BOT_COLOR_BONUS * picked[color],
    rated.rating,
  );
}

/** Every card in the pack, scored in pack order. */
export function simpleBotScores(pack: readonly CardRating[], picked: readonly Card[]): readonly number[] {
  const counts = countPickedColors(picked);
  return pack.map((rated) => simpleBotScore(rated, counts));
}

/**
 * The index the bot takes. Ties are broken uniformly at random from the fresh
 * stream the caller supplies, which is ADR-0003 §1's description of the source.
 * Ours is seeded and Draftmancer's is not, so a tie here is reproducible and a
 * tie there is not; nothing else about the choice differs.
 */
export function simpleBotPick(
  pack: readonly CardRating[],
  picked: readonly Card[],
  rng: Rng,
): readonly [number, Rng] {
  if (pack.length === 0) throw new DraftError('a bot cannot pick from an empty pack');
  const scores = simpleBotScores(pack, picked);
  const best = Math.max(...scores);
  const tied = scores.flatMap((score, index) => (score === best ? [index] : []));
  const [choice, advanced] = nextBelow(rng, tied.length);
  const index = tied[choice];
  if (index === undefined) throw new DraftError('a scored pack produced no best card');
  return [index, advanced];
}
