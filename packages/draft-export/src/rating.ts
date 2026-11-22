/**
 * The rating scale: `evaluateCard`'s score -> Draftmancer's 0-5 `rating`.
 *
 * This is the whole of a custom set's Draftmancer export intelligence. Draftmancer's own
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
 *
 * ## The score is the context-free one, and that is a decision (`mtg-s230`)
 *
 * `evaluateCard` is called with no `DeckContext`, so an activated ability whose
 * cost eats a permanent the deck has to have produced is priced at a supply
 * factor of 1: an outlet is rated as though it could always pay. That is a
 * ceiling, and `@mtg/deckbuild`'s `deck-pricing.ts` header carries the census
 * of who else takes one. Two things make it the right number here rather than
 * the absence of a better one.
 *
 * The set this would condition on cannot be a set that starves its outlets.
 * `@mtg/setgen`'s `checkSacrificeSupply` raises an error-level finding on a set
 * whose cost eats a subtype no card in the set creates, and it exists precisely
 * so `ActivationCost.sacrificeOther` could be reached from the generator at
 * all. The case a ceiling is badly wrong for is refused a set earlier than this.
 *
 * On a set that passes, the correction is below the resolution of the thing
 * consuming it. The flagship prints thirteen of these outlets; conditioning
 * each on a deck holding the set's own proportions moves its rating by at most
 * 0.0551 of the 0-5 band, against the `SIMPLE_BOT_COLOR_BONUS` of 0.35 that is
 * the bot's own step — less than a sixth of the unit the number is read in.
 * `outlet-rating.test.ts` derives both halves of that from the fixture rather
 * than restating them, so a set-conditioned model that did move the pick order
 * would fail this claim instead of quietly outliving it.
 *
 * The direction is deliberate too. A sacrifice outlet is a build-around, and
 * `SimpleBot` has no build-around reasoning: its only synergy term is color. A
 * drafter who takes the outlet is the drafter who has been taking the minters,
 * which no uniform sample of the set models, so an optimistic prior is what
 * lets the bot hold the card until its Parts arrive. A pessimistic one buries
 * the cards a set's mechanic is built on.
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

/**
 * Where a rating's number came from. the playtester's 2026-09-20 ruling on
 * `mtg-1j00i`: a rating's source is part of the rating, because an evaluator
 * score, an observed win rate and a community pick order are three different
 * quantities and must never sit unlabeled next to each other. The evaluator's
 * is ordinal within one set (ADR-0003); a win rate is an absolute proportion
 * comparable across sets; a community pick order (ADR-0005 rung 2) is an
 * ordinal pick order over one printed set, which is closer to the evaluator's
 * shape than to a win rate but is human judgment at scale rather than either
 * a design tool's opinion or a measurement. `'seventeen-lands'` (ADR-0005
 * rung 1) is measured too, but by real human drafters rather than our own
 * bots — `'play-data'` stays reserved for the latter, so the two never share
 * a source value even though both carry a `winRate`.
 */
export type RatingSource = 'evaluator' | 'play-data' | 'community-pick-order' | 'seventeen-lands';

/**
 * The evaluator-sourced rating carried on a DSL `Card`, in the flat shape the
 * Draftmancer export pipeline (`custom-cards.ts`, `simple-bot.ts`) reads
 * directly — it only ever rates generated-set cards, so it is typed over this
 * rather than the wider `CardRating` union.
 *
 * `PlayDataRating` is also keyed by `card`, but does not extend this: it holds
 * its 0-5 number under `simRating` rather than `rating`, for the reason
 * `CommunityPickOrderRating` and `SeventeenLandsRating` already hold theirs
 * under `quality` and `mappedRating` (`mtg-1j00i.6`, `mtg-tye7s`) — a name this
 * type shared with a second source is exactly what let a caller average two
 * incompatible quantities without ever checking `source`.
 */
export interface RatedCard {
  readonly card: Card;
  /** The Draftmancer rating, in [0, 5]. */
  readonly rating: number;
  readonly source: RatingSource;
}

/** A rating derived from `evaluateCard`'s context-free score. */
export interface EvaluatorRating extends RatedCard {
  readonly source: 'evaluator';
  /** The deck builder's raw score, kept so a rating can be argued with. */
  readonly score: number;
}

/**
 * A rating derived from observed play data rather than the evaluator. Does
 * not extend `RatedCard`: see that interface's doc comment for why its 0-5
 * number lives under `simRating` instead of `rating`.
 */
export interface PlayDataRating {
  readonly card: Card;
  readonly source: 'play-data';
  /** Observed win rate as an absolute proportion, e.g. 0.54 for 54%. */
  readonly winRate: number;
  /** The Draftmancer rating derived from `winRate`, in [0, 5]. */
  readonly simRating: number;
}

/**
 * A rating derived from a printed format's staged Forge Limited pick-order
 * data (ADR-0005 rung 2). Identified by physical card id rather than carried
 * on a DSL `Card`, because these rankings cover printed formats a generated
 * set can never be one of.
 *
 * Carries no `rating` field: Forge's staged 0-5 `quality` *is* the Draftmancer
 * rating for this rung, so a second field holding the identical number would
 * be the one thing every `CardRating` member shares, and `mtg-1j00i.6` found
 * that shared shape is exactly what lets a caller average two sources without
 * narrowing. `ratingValueOf` reads `quality` after checking `source`.
 */
export interface CommunityPickOrderRating {
  readonly physicalId: string;
  readonly source: 'community-pick-order';
  /** Forge's staged 0-5 quality for this physical card. */
  readonly quality: number;
}

/**
 * A rating derived from 17lands' own GAME dataset (ADR-0005 rung 1) — real
 * human drafters, not our bots. Identified by physical card id like
 * `CommunityPickOrderRating`, for the same reason: 17lands rates printed
 * cards, and a generated set is never one of the printed formats it covers.
 *
 * The 0-5 Draftmancer value is named `mappedRating`, not `rating` or
 * `simRating`: those belong to `EvaluatorRating` and `PlayDataRating`
 * respectively, and giving this variant either name would put a plain
 * `number` back on more than one `CardRating` member — the union-wide field
 * `mtg-1j00i.6` removed because it let two different sources be averaged
 * without ever checking `source`.
 */
export interface SeventeenLandsRating {
  readonly physicalId: string;
  readonly source: 'seventeen-lands';
  /** The Draftmancer rating, in [0, 5], mapped from `winRate`. */
  readonly mappedRating: number;
  /** Observed win-rate-when-drawn as an absolute proportion, e.g. 0.54 for 54%. */
  readonly winRate: number;
}

/** A bare number is not a valid rating; every rating states where it came from. */
export type CardRating = EvaluatorRating | PlayDataRating | CommunityPickOrderRating | SeventeenLandsRating;

/**
 * The one 0-5 number a `CardRating` offers to draw, whatever rung produced
 * it. Every `CardRating` member holds its number under a different field
 * name — that is the point, see `CommunityPickOrderRating` and
 * `SeventeenLandsRating` above — so this is the one place that narrows on
 * `source` to reach it, rather than every caller doing it separately.
 */
export function ratingValueOf(rating: CardRating): number {
  switch (rating.source) {
    case 'evaluator':
      return rating.rating;
    case 'play-data':
      return rating.simRating;
    case 'community-pick-order':
      return rating.quality;
    case 'seventeen-lands':
      return rating.mappedRating;
  }
}

/** Builds a rating from the deck builder's context-free evaluator score. */
export function evaluatorRating(card: Card, score: number, rating: number): EvaluatorRating {
  return { card, score, rating, source: 'evaluator' };
}

/** Builds a rating from our own bots' observed win rate. */
export function playDataRating(card: Card, winRate: number, simRating: number): PlayDataRating {
  return { card, winRate, simRating, source: 'play-data' };
}

/** Builds a rating from a printed format's staged Forge Limited quality. */
export function communityPickOrderRating(physicalId: string, quality: number): CommunityPickOrderRating {
  return { physicalId, quality, source: 'community-pick-order' };
}

/** Builds a rating from 17lands' observed win-rate-when-drawn for a printed card. */
export function seventeenLandsRating(
  physicalId: string,
  winRate: number,
  mappedRating: number,
): SeventeenLandsRating {
  return { physicalId, winRate, mappedRating, source: 'seventeen-lands' };
}

/**
 * One card's staged 17lands win-rate-when-drawn record, structurally (no
 * `@mtg/metrics` dependency). `winRate` is `null` exactly when `underSampled`
 * is true — the ingest tool abstains from a rate below its sample floor
 * rather than reporting noise as a measurement.
 */
export interface SeventeenLandsCardWinRate {
  readonly physicalId: string;
  readonly winRate: number | null;
  readonly samples: number;
  readonly floor: number;
  readonly underSampled: boolean;
}

/**
 * Maps a staged 17lands win-rate artifact onto Draftmancer's [0, 5] band, one
 * set at a time, following ADR-0003's shape for the evaluator (`rateCards`
 * above): a min-max map is monotone and invents no calibration constant, so
 * the bot's pick order inside a color is 17lands' own order.
 *
 * The map is fitted only over cards that clear the sample floor
 * (`samples >= floor && !underSampled`). An under-sampled card's win rate is
 * noise rather than a measurement — bad data would both skew the fitted band
 * and be reported as though it meant something — so it takes no part in
 * fitting the map and gets no entry in the returned map at all: a caller
 * reads a missing entry as "not ranked for this card", never as a rating of
 * 0. Fitting per set rather than to a fixed 0.50-0.62 window matters because
 * that window is KTK's; a set with a wider or narrower spread would be
 * stretched or compressed against a constant that has nothing to do with it.
 */
export function mapSeventeenLandsWinRates(
  cards: readonly SeventeenLandsCardWinRate[],
): ReadonlyMap<string, SeventeenLandsRating> {
  const ranked = cards.filter(
    (card): card is SeventeenLandsCardWinRate & { readonly winRate: number } =>
      !card.underSampled && card.winRate !== null && card.samples >= card.floor,
  );
  const rates = ranked.map((card) => card.winRate);
  const low = rates.length === 0 ? 0 : Math.min(...rates);
  const span = rates.length === 0 ? 0 : Math.max(...rates) - low;
  const midpoint = (RATING_MIN + RATING_MAX) / 2;

  const result = new Map<string, SeventeenLandsRating>();
  for (const card of ranked) {
    const mapped =
      span === 0 ? midpoint : RATING_MIN + ((card.winRate - low) / span) * (RATING_MAX - RATING_MIN);
    result.set(card.physicalId, seventeenLandsRating(card.physicalId, card.winRate, round(mapped)));
  }
  return result;
}

/**
 * ADR-0005 section 2's ladder: the highest-precedence rung that was actually
 * supplied wins, and an absent rung falls through to the next rather than the
 * caller inventing a zero or throwing. `undefined` back means no rung
 * answered for this card, which a caller reports as unranked rather than as a
 * measurement.
 *
 * Named rungs rather than a priority-ordered list, so the precedence is fixed
 * by the function's own shape and not by the order a caller happens to pass
 * arguments in. `seventeenLands` (rung 1) outranks `communityPickOrder`
 * (rung 2, Forge), which outranks `simPlayData` (rung 3, our own bots'
 * observed win rate), which outranks `evaluator` (rung 4, the context-free
 * fallback) — real human data beats human judgment at scale beats our own
 * measurement beats a design tool's opinion.
 */
export function resolveCardRating(rungs: {
  readonly seventeenLands?: SeventeenLandsRating | undefined;
  readonly communityPickOrder?: CommunityPickOrderRating | undefined;
  readonly simPlayData?: PlayDataRating | undefined;
  readonly evaluator?: EvaluatorRating | undefined;
}): CardRating | undefined {
  return rungs.seventeenLands ?? rungs.communityPickOrder ?? rungs.simPlayData ?? rungs.evaluator;
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
 *
 * Every rating this produces carries `source: 'evaluator'`, because that is
 * the only ground truth this function has.
 */
export function rateCards(
  cards: readonly Card[],
  weights: CardScoreWeights = DEFAULT_SCORE_WEIGHTS,
): readonly EvaluatorRating[] {
  const scored = cards.map((card) => ({ card, score: evaluateCard(card, weights).score }));
  const spellScores = scored.filter((entry) => !isLand(entry.card)).map((entry) => entry.score);
  const low = Math.min(...spellScores);
  const span = Math.max(...spellScores) - low;
  const midpoint = (RATING_MIN + RATING_MAX) / 2;

  return scored.map((entry) => {
    if (isLand(entry.card)) return evaluatorRating(entry.card, entry.score, RATING_MIN);
    if (span === 0) return evaluatorRating(entry.card, entry.score, midpoint);
    const share = (entry.score - low) / span;
    return evaluatorRating(entry.card, entry.score, round(RATING_MIN + share * (RATING_MAX - RATING_MIN)));
  });
}
