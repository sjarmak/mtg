/**
 * The rating scale: `evaluateCard`'s score -> Draftmancer's 0-5 `rating`.
 *
 * This is the whole of a custom set's bot intelligence. Draftmancer's own
 * source says so: `fallbackToSimpleBots()` returns true whenever any custom
 * card lacks an oracle id, so a generated set is always drafted by `SimpleBot`,
 * whose entire algorithm is
 *
 *     score = card.rating + 0.35 x (already-picked cards in each of its colors)
 *
 * (`docs/research/prior-art-tooling.md` §1.1, verified against `src/Bot.ts`).
 * Everything the bot knows about our cards therefore arrives through one number
 * per card, and ADR-0003 settles which number.
 *
 * The transform is a min-max map of the deck builder's score onto [0, 5]: it is
 * monotone, so the bot's pick order inside a color is the deck builder's pick
 * order, and it invents no calibration constant. What it does *not* claim is
 * that a 4.0 here means what a 4.0 means in another set — the scale is ordinal
 * within one set, because the only ground truth we have is one evaluator's
 * ordering, and ADR-0003 says so out loud rather than fitting a curve we have
 * no data for.
 *
 * Lands are the one card class held out of that map. `evaluateCard` scores
 * every land 0 by construction — "the mana base is built separately" — so the
 * 0 is a sentinel rather than a measurement, and normalizing it alongside real
 * scores rates a basic above every spell that scores negative. A basic in a
 * pack is never the pick, so lands take the floor of the band and the map is
 * fitted to the cards the evaluator actually has an opinion about.
 */
import type { CardScoreWeights } from '@mtg/deckbuild';
import { DEFAULT_SCORE_WEIGHTS, evaluateCard } from '@mtg/deckbuild';
import type { Card } from '@mtg/dsl';
import { isLand } from '@mtg/dsl';

/** Bottom of Draftmancer's rating band. */
export const RATING_MIN = 0;

/** Top of Draftmancer's rating band. */
export const RATING_MAX = 5;

/**
 * The color-affinity bonus `SimpleBot` adds per already-picked on-color card,
 * read from Draftmancer's `src/Bot.ts` (tooling §1.1). It is the only quantity
 * in the bot we do not supply, so it is the unit the rating band is measured in.
 */
export const SIMPLE_BOT_COLOR_BONUS = 0.35;

/**
 * The rating band expressed in color-affinity steps: ~14.3. A bot that has
 * already taken fifteen cards of a color will take the worst card in that
 * color over the best card outside it, and no fewer will do it. That is the
 * one hard number the scale has to answer to, and a wider band would make the
 * bot ignore color while a narrower one would make it ignore card quality.
 */
export const RATING_RANGE_IN_COLOR_CARDS = (RATING_MAX - RATING_MIN) / SIMPLE_BOT_COLOR_BONUS;

/**
 * Decimal places kept in the emitted rating. Three is far finer than the 0.35
 * step the bot reasons in, so rounding never reorders two cards the evaluator
 * separated, and it keeps the emitted file byte-stable.
 */
const RATING_DECIMALS = 3;

export interface CardRating {
  readonly card: Card;
  /** The deck builder's raw score, kept so a rating can be argued with. */
  readonly score: number;
  /** The Draftmancer rating, in [0, 5]. */
  readonly rating: number;
}

function round(value: number): number {
  const factor = 10 ** RATING_DECIMALS;
  return Math.round(value * factor) / factor;
}

/**
 * Rates a whole set at once, because the scale is set-relative: a card's rating
 * is its place between the worst and best *spell* in the set it is drafted
 * from. Spells the evaluator cannot separate — one spell, or a set of equals —
 * rate at the midpoint rather than at either end, since 0 and 5 would both be
 * claims the evaluator did not make. Lands rate at the floor whatever else the
 * set holds.
 */
export function rateCards(
  cards: readonly Card[],
  weights: CardScoreWeights = DEFAULT_SCORE_WEIGHTS,
): readonly CardRating[] {
  const scored = cards.map((card) => ({ card, score: evaluateCard(card, weights).score }));
  const spellScores = scored.filter((entry) => !isLand(entry.card)).map((entry) => entry.score);
  const low = Math.min(...spellScores);
  const span = Math.max(...spellScores) - low;
  const midpoint = (RATING_MIN + RATING_MAX) / 2;

  return scored.map((entry) => {
    if (isLand(entry.card)) return { ...entry, rating: RATING_MIN };
    if (span === 0) return { ...entry, rating: midpoint };
    const share = (entry.score - low) / span;
    return { ...entry, rating: round(RATING_MIN + share * (RATING_MAX - RATING_MIN)) };
  });
}
