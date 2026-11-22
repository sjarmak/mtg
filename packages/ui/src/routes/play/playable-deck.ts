/**
 * A deck the Play tab can seat, whoever made it.
 *
 * The playtester, 2026-09-01: *"I just want to be able to do a selectable deck like
 * from the play tab the same way we can easily play a paired game of sky
 * islands vs down in the gloom, where it's either against a bot or on the
 * LAN."*
 *
 * That surface was `PreconDeck`-shaped end to end: the picker drew
 * `PreconFacts`, the dealer took two `PreconDeck` ids and resolved them through
 * `buildPrecon`, and a deck that was not in the set's written file could not be
 * named anywhere in it. A deck the workbench built is a finished, designed
 * sixty of cards this kernel runs — the same thing a precon is, arrived at
 * differently — so what the picker needs is not a precon but a *list with a
 * name*.
 *
 * This is that: the tile's facts and the cards to deal, with where it came from
 * kept as a badge rather than as a type. `../play/deal.ts`'s `dealDeckMatch`
 * already takes exactly `{ name, cards }`, which is why the dealer needed
 * nothing new.
 *
 * # Why a variation's cards are resolved here rather than through the builder
 *
 * `../deck/workbench/play.ts`'s `reopenVariation` answers a different question —
 * it produces a `ConstructedBuild`, because the workbench hands its decks to a
 * builder that can edit them. That build keys basics by **color**
 * (`BasicLandCounts`), so the set a basic was recorded from is dropped and the
 * builder re-apportions them out of whatever pool it was given: a deck built
 * from XMP alone comes back holding M11 Plains (`mtg-ac0h`).
 *
 * Nothing here edits anything, so nothing here needs a build. Every entry is
 * resolved by the id the variation recorded, basics included, and the deck
 * dealt is the deck written down.
 */
import type { Card, Color } from '@mtg/dsl';
import { COLORS } from '@mtg/dsl';
import { buildPrecon } from '@mtg/deckbuild';
import type { PreconDeck } from '@mtg/deckbuild';
import type { Variation } from '../deck/workbench/client';
import { preconFacts } from './precon-facts';

/** Where a playable deck came from, which is a badge on its tile and nothing more. */
export type DeckOrigin = 'precon' | 'built';

export interface PlayableDeck {
  /** Unique across every deck offered at once. A precon id, or a variation id. */
  readonly id: string;
  readonly name: string;
  /** The deck's own sentence: a precon's plan, or the words somebody asked for. */
  readonly plan: string;
  /** The list, in the order it will be shuffled from. */
  readonly cards: readonly Card[];
  /** WUBRG order, off the mana base rather than off what the spells demand. */
  readonly colors: readonly Color[];
  readonly spells: number;
  readonly lands: number;
  readonly creatures: number;
  readonly rares: number;
  /** A card the deck is about, or `null` when nothing names one. */
  readonly centerpiece: string | null;
  /** Whether the list resolves to a legal deck of the size it states. */
  readonly complete: boolean;
  readonly origin: DeckOrigin;
  /**
   * The staged sets this deck is cut from, by code.
   *
   * A precon belongs to one set. A deck somebody described may name several —
   * Vessari-v3 states `XMP, M11, M13, RTR` — which is why the Play tab cannot be
   * "the decks of the set you are browsing" any more, and why the filter over
   * this row is a filter rather than the set picker in the header.
   */
  readonly sets: readonly string[];
}

/** One of the set's written decks, resolved against the staged cards. */
export function playablePrecon(deck: PreconDeck, set: readonly Card[], setCode: string): PlayableDeck {
  const facts = preconFacts(deck, set);
  return {
    id: deck.id,
    name: deck.name,
    plan: deck.plan,
    cards: buildPrecon(deck, set).deck,
    colors: facts.colors,
    spells: facts.spells,
    lands: facts.lands,
    creatures: facts.creatures,
    rares: facts.rares,
    centerpiece: facts.payoffName === '' ? null : facts.payoffName,
    complete: facts.complete,
    origin: 'precon',
    sets: [setCode],
  };
}

/** Cards the staged sets no longer hold, by the name the variation recorded. */
export interface MissingCards {
  readonly missing: readonly string[];
}

/**
 * One deck the workbench built, resolved against the staged cards.
 *
 * Returns what is missing rather than a short deck: a list four cards down is a
 * different deck from the one somebody named, and dealing it quietly is how a
 * game becomes evidence about a deck nobody built.
 */
export function playableVariation(variation: Variation, pool: readonly Card[]): PlayableDeck | MissingCards {
  const byId = new Map(pool.map((card) => [card.id, card]));
  const cards: Card[] = [];
  const missing: string[] = [];

  // Spells, lands and basics alike, each by the id its own entry recorded. The
  // basics are the reason this is not `reopenVariation`: see the docblock.
  for (const entry of [...variation.spells, ...variation.lands]) {
    const card = byId.get(entry.id);
    if (card === undefined) {
      missing.push(entry.name);
      continue;
    }
    for (let copy = 0; copy < entry.count; copy += 1) cards.push(card);
  }
  for (const basic of variation.basics) {
    const card = byId.get(basic.id);
    if (card === undefined) {
      missing.push(basic.id);
      continue;
    }
    for (let copy = 0; copy < basic.count; copy += 1) cards.push(card);
  }
  if (missing.length > 0) return { missing };

  const spells = cards.filter((card) => card.kind !== 'land');
  return {
    id: variation.id,
    name: variation.name,
    // The person's own words. A precon's plan is one clause written to fit a
    // tile and a prompt is not, so the tile clamps it rather than cutting it
    // (`../deck/DeckCard.ts` does the clamping, in the sheet).
    plan: variation.criteria.prompt,
    cards,
    // Off the mana base the build counted out, which is `../deck/DeckLibrary.ts`'s
    // rule: `criteria.colors` is what somebody asked for and is empty whenever
    // they let the model choose.
    colors: COLORS.filter((color) =>
      variation.manaBase.colors.some((entry) => entry.color === color && entry.pipCount > 0),
    ),
    spells: spells.length,
    lands: cards.length - spells.length,
    creatures: spells.filter((card) => card.kind === 'creature').length,
    rares: spells.filter((card) => card.rarity === 'rare' || card.rarity === 'mythic').length,
    // A built deck names no payoff: nothing in the criteria says which card the
    // deck is about, and picking one here would be this file inventing a fact.
    centerpiece: null,
    // The cards it holds against the size it states, and not `shortfalls`. A
    // built deck's shortfalls are the mana base's advice — "W casts Oblivion
    // Ring on curve only 70% of the time" — which is a true thing to say about a
    // legal sixty and no reason to refuse to deal it. Vessari-v3 is exactly that,
    // and blocking it made the play button dark on a deck that plays fine.
    // Vessari-v1, at 3 cards of a stated 60, is the case this does stop.
    complete: cards.length >= variation.criteria.size,
    origin: 'built',
    sets: variation.criteria.sets,
  };
}

/** Whether a resolve came back short, so a caller can narrow without a cast. */
export function isMissing(result: PlayableDeck | MissingCards): result is MissingCards {
  return 'missing' in result;
}
