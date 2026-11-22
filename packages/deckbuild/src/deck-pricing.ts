/**
 * The second pass: price every playable against the deck the first pass built.
 *
 * `evaluatePool` scores cards in isolation, which is the right thing exactly
 * once — when the color pair is being chosen and no deck exists yet. After that
 * the isolation is the defect `mtg-f0nf` names: a tribal lord, a conditional
 * static and a counter-restricted removal spell are all worth what the deck
 * around them makes them worth, and a scorer that cannot see the deck prices
 * every one of them at a flat weight measured on the decks that same scorer
 * built. The loop closes on itself.
 *
 * ## Why a second pass and not a running one
 *
 * The bead's other option is to re-price after every pick. That would re-rank
 * the whole playable list twenty-three times per deck and would have to be
 * threaded through `selectSpells`'s three-pass curve fill, and the information
 * it buys is worse rather than better: at pick three the deck-so-far is three
 * cards, and the subtype share of three cards is noise. A finished
 * twenty-three-card deck is the composition a card will actually be played
 * alongside, so pricing against it is both the smaller change and the better
 * estimate. `selectSpells` is untouched; it is simply run twice, on two
 * different prices.
 *
 * ## Why exactly two, and never iterated
 *
 * A third pass would price against a deck built from the second pass's prices,
 * a fourth against the third, and the sequence converges on whatever the
 * builder already liked — the same circularity `ability-weight-census.ts` refuses
 * to iterate its measured table into, one level down. Two is the smallest
 * number that lets a price see a deck, and it is fixed.
 *
 * ## The two directions
 *
 * A card is worth what it gains from the deck *and* what the deck gains from
 * it, and both have to be counted or the loop never opens: a Merfolk is a better
 * card in a deck holding a Merfolk lord, and nothing in a per-card score can say
 * so. The two are counted once each and never twice — the lord's own price
 * carries the whole anthem (its reach is the deck's Merfolk share), and each Merfolk
 * carries only the *delta* it makes to that reach by joining. That is the
 * marginal value of adding the card to the deck, `deckValue(S + c) -
 * deckValue(S)`, and it decomposes without double counting by construction.
 *
 * ## Who prices without a deck, and why each is allowed to
 *
 * `evaluateCard`'s context is optional, so omitting it is a decision rather
 * than an omission, and eight shipped source surfaces make it (`mtg-zvtt`;
 * `context-free-callers.test.ts` derives that census from the checkout, so this
 * paragraph fails rather than goes stale). The fallback that matters is the
 * two sacrifice-cost supply factors, which fall back to 1: an outlet that eats
 * two Parts is priced as though it could always pay, in a pool that mints none.
 *
 * Both factors are probabilities, so they only ever multiply a price *down*.
 * That makes the context-free score a **ceiling** on the deck-conditioned one,
 * and the census divides on what each caller does with a ceiling.
 *
 * - `evaluatePool`, one file over, is the first pass of this very two-pass
 *   build. No deck exists yet; producing one is what the ranking is for, and
 *   the second pass re-prices every outlet against the deck it produced. A
 *   fallback of 0 would hide an outlet from the only ranking that could ever
 *   have drafted it something to eat.
 * - `@mtg/setgen`'s `cardRate` divides the score by mana value and fails a
 *   card *over* a ceiling. A one-sided gate fed a ceiling can only false-
 *   positive: it may flag a card whose outlet the set cannot feed, and it can
 *   never pass one that is genuinely over-rate. `rate.ts` draws no floor of its
 *   own — its own header argues why at length — so there is no second direction
 *   for the inflation to escape through.
 * - `@mtg/metrics`'s `color-census.ts` and `color-drift.ts` and `@mtg/ui`'s
 *   `design-review-page.ts` report a number rather than gate on one, and the
 *   number they report is the one every other context-free surface prints.
 *   Conditioning one of them alone would make two reports of the same card
 *   disagree for a reason neither report states.
 * - `@mtg/draft-export`'s `rateCards` keeps the ceiling on purpose, and
 *   `rating.ts` carries the measurement (`mtg-s230`). The set it would
 *   condition on cannot be one that starves its outlets: `@mtg/setgen`'s
 *   `checkSacrificeSupply` is an error-level finding on a set whose cost eats a
 *   subtype no card in it creates, so the case a ceiling is badly wrong for
 *   does not ship. In the flagship, which does print thirteen of these outlets,
 *   conditioning on the set moves every one of them less than a tenth of the
 *   step the bot reasons in.
 * - Native draft prepares that same context-free evaluation once for each card
 *   in `draft.ts`. `native-draft-bot.ts` reads the prepared result during a
 *   full draft and computes the candidate's deck-conditioned delta separately.
 *   Its two direct calls are fallbacks for the exported scorer when a caller
 *   has not supplied the prepared map: one preserves the set-relative base
 *   rating and one supplies removal metadata for already-picked cards. Neither
 *   replaces the contextual candidate evaluation that chooses a pick.
 */
import type { Card } from '@mtg/dsl';
import { hasTarget, printedCardSurface, printedEntryReplacement } from '@mtg/dsl';
import type { CardScoreWeights, DeckBuildConfig } from './config';
import type { DeckContext } from './deck-context';
import { deckContextOf, deckContextWith } from './deck-context';
import type { PoolCard, ScoreComponent } from './evaluate';
import { comparePoolCards, evaluateCard, isRemovalCard, reachabilityOf } from './evaluate';

/**
 * True when anything printed on `value` counts permanents carrying a counter
 * the deck places.
 *
 * The one tally `evaluate.ts`'s `measuredTally` answers from the deck census,
 * found by a structural scan rather than by a list of the fields that can hold
 * one. `countWithCounter` is a member of two unions — `Amount` and
 * `PermanentTally` (`@mtg/dsl`'s `amount.ts`) — and between them those are
 * reachable from every effect that prints a quantity, from `statBonusPer`'s
 * tally, and from the `ratePer` inside either. A field list here would be a
 * second census of the amount vocabulary maintained by hand beside the
 * schema's, and the way it fails is silent: a card whose price moves with the
 * deck quietly stops being re-priced, and nothing in a passing suite says so.
 *
 * `countMatching` is deliberately not in this scan, and `measuredTally`'s
 * docblock argues why: the deck census answers a supply and that tally asks a
 * board occupancy. A card printing one is priced the same in every deck, so
 * naming it here would buy a re-score that returns the same number.
 */
function countsCounterBearers(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(countsCounterBearers);
  if (typeof value !== 'object' || value === null) return false;
  const record: Record<string, unknown> = value as Record<string, unknown>;
  if (record.kind === 'countWithCounter') return true;
  return Object.values(record).some(countsCounterBearers);
}

/**
 * True when a card's price can move with the deck around it.
 *
 * The seven sites `evaluateCard` conditions, and nothing else: a subtype-
 * narrowed static, a static behind an `enabledWhile` condition, an effect whose
 * target restriction names a counter, an activation whose typed cost eats
 * a permanent the deck has to have produced, a card that answers a creature,
 * a permanent that enters as a copy of a creature already on the
 * battlefield, and a printed quantity that counts permanents carrying a counter
 * the deck's own cards place.
 * Every other card scores the same in every deck, so the unlock
 * sum below skips it rather than re-scoring it.
 *
 * The fourth is what makes the second direction work for an outlet, and it is
 * the reason this list is a list rather than "cards with abilities". A card
 * that mints Parts is worth more in a deck holding an outlet, and the only way
 * that shows up is the outlet being re-priced when the Part maker joins; a
 * builder that skipped the outlet here would credit the maker nothing for the
 * card it turns on and pick a vanilla body over it.
 */
export function readsTheDeck(card: Card, weights: CardScoreWeights): boolean {
  // The fifth, and the only one that is not a printed clause: an answer's
  // premium is discounted by how many answers the deck already holds
  // (`removalSaturation`), so adding one lowers the price of every other one.
  // Counting it here is what turns that discount into a reason not to take the
  // tenth answer — a candidate that is only charged on its own price is barely
  // charged at all, and the deck the builder assembles would not move.
  if (isRemovalCard(card, weights)) return true;
  const surface = printedCardSurface(card);
  const abilityReads = surface.abilities.some(
    (ability) =>
      (ability.kind === 'static' &&
        (ability.subtype !== null ||
          ('enabledWhile' in ability && (ability.enabledWhile ?? null) !== null))) ||
      (ability.kind === 'activated' &&
        (ability.cost.sacrificeOther !== undefined || ability.cost.sacrificeMatching !== undefined)),
  );
  if (abilityReads) return true;
  // The seventh: a quantity counting permanents the deck supplies — bearers of
  // a counter its cards place, or permanents matching a filter its cards mint —
  // is answered by the deck census rather than by a flat constant, so a minter
  // joining the deck re-prices every build-around counting them, and a
  // build-around joining a deck that mints none is re-priced down to what its
  // body is worth. `mtg-cosl`.
  if (countsCounterBearers(surface.abilities) || countsCounterBearers(surface.effects)) {
    return true;
  }
  // The sixth: a clone is worth the best body the deck can supply
  // (`copiedBodyValue`), so a clone already in the deck is re-priced upward the
  // moment a bigger creature joins it. Skipping it here would credit that
  // creature nothing for what it hands the clone, which is the same omission
  // the fourth site describes for an outlet and its Part maker.
  if (printedEntryReplacement(card)?.kind === 'entersAsCopyOfCreature') return true;
  return surface.effects.some(
    (effect) => hasTarget(effect) && effect.target.restriction?.kind === 'withCounter',
  );
}

function withComponent(
  evaluation: ReturnType<typeof evaluateCard>,
  poolIndex: number,
  unlock: number,
): PoolCard {
  if (unlock === 0) return { ...evaluation, poolIndex };
  const components: readonly ScoreComponent[] = [
    ...evaluation.components,
    { name: 'deckUnlock', value: unlock },
  ];
  return { ...evaluation, components, score: evaluation.score + unlock, poolIndex };
}

/**
 * Re-scores `playables` against `deck`, best-first.
 *
 * Every candidate is priced as a *member* of the deck — the context includes
 * the candidate itself, because a card that satisfies its own condition (a Merfolk
 * that reads "as long as you control two Merfolk", a creature that puts the gloom
 * counter its own static wants) turns itself on. A candidate already in the
 * deck is counted once: its context is the deck as it stands, and its unlock is
 * zero, because it has already been added.
 *
 * The ordering is the same total order the first pass uses (score descending,
 * pool position ascending), so the result is a pure, order-stable function of
 * (playables, deck, config).
 */
export function priceAgainstDeck(
  playables: readonly PoolCard[],
  deck: readonly PoolCard[],
  config: DeckBuildConfig,
): readonly PoolCard[] {
  const weights = config.weights;
  const base: DeckContext = deckContextOf(
    deck.map((pick) => pick.card),
    config,
  );
  const held = deck.filter((pick) => readsTheDeck(pick.card, weights));
  const heldBefore = new Map(
    held.map((pick) => [pick.poolIndex, evaluateCard(pick.card, weights, base).score]),
  );
  const inDeck = new Set(deck.map((pick) => pick.poolIndex));

  const priced = playables.map((candidate) => {
    const joined = inDeck.has(candidate.poolIndex);
    const context = joined ? base : deckContextWith(base, candidate.card, weights);
    const own = evaluateCard(candidate.card, weights, context);
    if (joined) return withComponent(own, candidate.poolIndex, 0);

    let unlock = 0;
    for (const pick of held) {
      const before = heldBefore.get(pick.poolIndex) ?? 0;
      unlock += evaluateCard(pick.card, weights, context).score - before;
    }
    return withComponent(own, candidate.poolIndex, unlock * reachabilityOf(candidate.card, weights));
  });
  return [...priced].sort(comparePoolCards);
}
