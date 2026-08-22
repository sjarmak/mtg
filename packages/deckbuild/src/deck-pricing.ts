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
 */
import type { Card } from '@mtg/dsl';
import { printedEffects } from '@mtg/dsl';
import type { DeckBuildConfig } from './config';
import type { DeckContext } from './deck-context';
import { deckContextOf, deckContextWith } from './deck-context';
import type { PoolCard, ScoreComponent } from './evaluate';
import { comparePoolCards, evaluateCard, reachabilityOf } from './evaluate';

/**
 * True when a card's price can move with the deck around it.
 *
 * The four sites `evaluateCard` conditions, and nothing else: a subtype-
 * narrowed static, a static behind an `enabledWhile` condition, an effect whose
 * target restriction names a counter, and an activation whose cost eats a
 * permanent the deck has to have produced. Every other card scores the same in
 * every deck, so the unlock sum below skips it rather than re-scoring it.
 *
 * The fourth is what makes the second direction work for an outlet, and it is
 * the reason this list is a list rather than "cards with abilities". A card
 * that mints Parts is worth more in a deck holding an outlet, and the only way
 * that shows up is the outlet being re-priced when the Part maker joins; a
 * builder that skipped the outlet here would credit the maker nothing for the
 * card it turns on and pick a vanilla body over it.
 */
export function readsTheDeck(card: Card): boolean {
  const abilityReads = card.abilities.some(
    (ability) =>
      (ability.kind === 'static' && (ability.subtype !== null || (ability.enabledWhile ?? null) !== null)) ||
      (ability.kind === 'activated' && ability.cost.sacrificeOther !== undefined),
  );
  if (abilityReads) return true;
  return printedEffects(card).some(
    (effect) => 'target' in effect && effect.target.restriction?.kind === 'withCounter',
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
  const held = deck.filter((pick) => readsTheDeck(pick.card));
  const heldBefore = new Map(
    held.map((pick) => [pick.poolIndex, evaluateCard(pick.card, weights, base).score]),
  );
  const inDeck = new Set(deck.map((pick) => pick.poolIndex));

  const priced = playables.map((candidate) => {
    const joined = inDeck.has(candidate.poolIndex);
    const context = joined ? base : deckContextWith(base, candidate.card);
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
