/**
 * The second pool source: a cube cut from a generated DSL set.
 *
 * `universe.ts` narrows the card store, and none of it can be reused here. A
 * DSL card has no format legality, no USD price and no printing rows, so
 * `@mtg/decklab`'s `selectUniverse` — the query that file exists to project
 * onto — has nothing to select on. This is a second source behind the same
 * `CubePool` interface rather than a variant of the first: `construct.ts`,
 * `propose.ts` and `validate.ts` never learn which one they were handed.
 *
 * ## Why the gate's two answers collapse to one here
 *
 * Over the store, `knownNames` is every real card name and the pool is the
 * subset the restrictions allow, so a name outside the pool is two different
 * failures with two different fixes: a card that does not exist ("stop making
 * cards up") and a real card the cube may not have ("that one is illegal here,
 * pick another"). Over a generated set there is no larger world to be real in.
 * The set is the only thing that exists, so `knownNames` is the set's own card
 * list and every name outside it is the same failure — a name this cube's
 * vocabulary does not contain — reported once instead of split between two
 * messages, one of which could never fire.
 *
 * ## A criterion the pool cannot carry is refused, not ignored
 *
 * A price ceiling over cards that have no price is a criterion nothing can
 * enforce, and the prompt would go on to tell the model that every card in the
 * pool is already under it. That is a false statement to the model and a
 * criterion in the report that nothing checked, so it is an error instead.
 */
import type { CandidateCard } from '@mtg/decklab';
import { normalizeName, parseManaCost } from '@mtg/decklab';
import type { Card, Color } from '@mtg/dsl';
import {
  cardManaValue,
  formatManaCost,
  isCastable,
  KEYWORD_PRINT_NAMES,
  renderOracleText,
  renderTypeLine,
  sortColors,
} from '@mtg/dsl';
import type { CubeCriteria } from './criteria';
import type { CubePool } from './universe';

/**
 * A generated set as this package needs it: the cards, and enough identity to
 * say in the prompt and the report which set the cube was cut from.
 *
 * Structurally a `SetFile`'s `set` block plus its `cards`, taken as its parts so
 * that reading and validating a set file stays with the caller that owns the
 * file — `@mtg/setgen` owns `SetFileSchema`, and this package does not need to
 * depend on the generator to measure its output.
 */
export interface GeneratedSet {
  readonly code: string;
  readonly name: string;
  readonly cards: readonly Card[];
}

export class UnpriceableCubePoolError extends Error {
  constructor(readonly maxCardUsd: number) {
    super(
      `a generated set carries no prices, so a $${String(maxCardUsd)} per-card ceiling cannot be applied to it; ` +
        'drop the price ceiling, or build this cube over the card store',
    );
    this.name = 'UnpriceableCubePoolError';
  }
}

export class DuplicateSetCardError extends Error {
  constructor(readonly cardName: string) {
    super(`the set names ${cardName} twice; a cube is drafted by name, so two cards cannot share one`);
    this.name = 'DuplicateSetCardError';
  }
}

/**
 * Every card in the set, as the pool the model proposes against.
 *
 * The whole set, with no filter of its own: a generated set is already the
 * designed pool, and narrowing it here would be a quality judgment made in code
 * over exactly the cards the model was asked to judge.
 */
export function setCubePool(set: GeneratedSet, criteria: CubeCriteria): CubePool {
  if (criteria.maxCardUsd !== undefined) throw new UnpriceableCubePoolError(criteria.maxCardUsd);

  const cards = set.cards.map(candidateFromDslCard);
  const byName = new Map<string, CandidateCard>();
  for (const card of cards) {
    const key = normalizeName(card.name);
    if (byName.has(key)) throw new DuplicateSetCardError(card.name);
    byName.set(key, card);
  }

  return {
    universe: {
      cards,
      byName,
      filters: [
        `every card in ${set.name} (${set.code})`,
        'a generated set: no format legality and no price applies, and no card outside it exists',
      ],
    },
    knownNames: new Set(byName.keys()),
    // Keyed on the id `candidateFromDslCard` used as the oracle id, so a finished
    // entry can be handed back to the draft runtime as the card it came from.
    draftable: new Map(set.cards.map((card) => [card.id, card])),
  };
}

/**
 * A DSL card in the shape the cube's checks read.
 *
 * Every field is derived rather than invented. The card id is the identity the
 * copy limit counts on, because a generated set's ids are unique within it the
 * way an oracle id is unique in the store. `priceUsd` is `null` — the honest
 * value for a card that was never printed — and not a zero that would read as
 * free.
 *
 * Color identity follows rule 903.5d rather than the printed cost: a DSL land
 * declares no colors and taps for one, and that produced color is its identity,
 * which is what makes a generated Mountain red to an archetype the way Scryfall
 * makes the printed one red.
 */
export function candidateFromDslCard(card: Card): CandidateCard {
  const manaCost = isCastable(card) ? formatManaCost(card.manaCost) : null;
  const identity =
    card.kind === 'land' ? card.producesMana.filter((mana): mana is Color => mana !== 'C') : card.colors;
  return {
    oracleId: card.id,
    name: card.name,
    manaCost,
    manaValue: cardManaValue(card),
    typeLine: renderTypeLine(card),
    oracleText: renderOracleText(card),
    power: card.power === undefined ? null : String(card.power),
    toughness: card.toughness === undefined ? null : String(card.toughness),
    colorIdentity: sortColors(identity).join(''),
    keywords: card.keywords.map((keyword) => KEYWORD_PRINT_NAMES[keyword]),
    priceUsd: null,
    parsedCost: parseManaCost(manaCost),
    producedMana: card.kind === 'land' ? card.producesMana.filter((mana): mana is Color => mana !== 'C') : [],
  };
}
