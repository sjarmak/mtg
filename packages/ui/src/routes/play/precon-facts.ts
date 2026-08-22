/**
 * What a written deck list is, measured rather than written down beside it.
 *
 * A precon file states an id, a count and a sentence. Everything else a person
 * wants before they pick one — the colors, how many creatures, which of them
 * are rare, what the payoff is called — is a fact about the resolved cards, and
 * the moment it is also typed into the file it is a second copy that goes
 * stale. So the file says as little as it can and this says the rest.
 *
 * It is separate from the picker that draws it so the numbers can be asserted
 * without rendering anything, and separate from `@mtg/deckbuild` because it is
 * a summary for a screen rather than part of building a legal deck.
 */
import type { Card, Color } from '@mtg/dsl';
import { COLORS } from '@mtg/dsl';
import { buildPrecon, resolvePreconSpells } from '@mtg/deckbuild';
import type { PreconDeck, PreconFile } from '@mtg/deckbuild';

export interface PreconFacts {
  readonly deck: PreconDeck;
  /** WUBRG order, from the mana base the list counted out. */
  readonly colors: readonly Color[];
  readonly spells: number;
  readonly lands: number;
  readonly creatures: number;
  /** Cards at rare or mythic: how many of the list's spells are its top tier. */
  readonly rares: number;
  /** The payoff card's printed name, so the tile says a card rather than an id. */
  readonly payoffName: string;
  /** True when the list resolves to a legal deck of the size it states. */
  readonly complete: boolean;
}

export function preconFacts(deck: PreconDeck, set: readonly Card[]): PreconFacts {
  const spells = resolvePreconSpells(deck, set);
  const built = buildPrecon(deck, set);
  const payoff = spells.find((card) => card.id === deck.payoff);
  return {
    deck,
    // Read off the list's own basics rather than off `built.colors`, which is
    // what the *spells* demand: a deck that splashes one card is still the two
    // colors its mana base is, and that is the pair a person is choosing.
    colors: COLORS.filter((color) => (deck.basics[color] ?? 0) > 0),
    spells: built.spells.length,
    lands: built.lands.length,
    creatures: spells.filter((card) => card.kind === 'creature').length,
    // Rare *or better*: a mythic is not fewer rares than a rare, and an
    // equality on the word alone reported a list whose best card was promoted
    // to mythic as having one less. The tile says "rare" and means the top of
    // the list.
    rares: spells.filter((card) => card.rarity === 'rare' || card.rarity === 'mythic').length,
    // `resolvePreconSpells` has already refused a payoff the list does not
    // play, so this is unreachable rather than a fallback worth designing.
    payoffName: payoff?.name ?? deck.payoff,
    complete: built.complete,
  };
}

/**
 * Why this file cannot be played against this set, or `null` when it can.
 *
 * Checked before anything is dealt, because the failure it catches is a file
 * pointed at the wrong set — a precon file and a set document are staged
 * separately and both call themselves XMP, so the pairing is exactly the thing
 * nothing else verifies. `resolvePreconSpells` names every missing id, and that
 * message is what a person needs; the alternative is a blank tab.
 */
export function preconProblem(file: PreconFile, set: readonly Card[]): string | null {
  for (const deck of file.decks) {
    try {
      preconFacts(deck, set);
    } catch (cause: unknown) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  }
  return null;
}
