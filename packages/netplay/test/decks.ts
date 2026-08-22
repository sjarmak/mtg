/**
 * Two decks whose every spell has a name of its own.
 *
 * The concealment test is a text search over a payload, and a text search needs
 * a name that identifies one card rather than a printing. Real decks run four
 * copies of a thing, so "the name is absent" would go false the moment any copy
 * reached the battlefield and the test would be asserting nothing about the
 * twenty-three still in the library. Numbering every spell makes each name a
 * pointer to exactly one object, which is what turns "not in the payload" into a
 * claim about that object.
 *
 * The cards are invented rather than borrowed, because a test that needs a
 * creature name should not reach for a set's (`AGENTS.md`, the public boundary).
 * The basics are the real fixtures, because mana has to work.
 */
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { DeckList } from '@mtg/kernel';

const SPELLS_PER_DECK = 23;
const LANDS_PER_DECK = 17;

/** A vanilla creature, distinguishable from every other card in the game by name. */
function numbered(prefix: string, index: number, color: 'R' | 'G'): Card {
  const label = `${prefix} ${String(index)}`;
  return parseCard({
    kind: 'creature',
    id: `netplay-${prefix.toLowerCase().replace(/ /g, '-')}-${String(index)}`,
    name: label,
    rarity: 'common',
    set: { code: 'NET', collectorNumber: index },
    manaCost: { generic: 1, [color]: 1 },
    colors: [color],
    subtypes: ['Scout'],
    power: 2,
    toughness: 2,
  });
}

function basic(type: 'Mountain' | 'Forest', color: 'R' | 'G', collectorNumber: number): Card {
  return parseCard({
    kind: 'land',
    id: `netplay-${type.toLowerCase()}`,
    name: type,
    rarity: 'common',
    set: { code: 'NET', collectorNumber },
    supertypes: ['basic'],
    basicLandType: type,
    producesMana: [color],
  });
}

function deck(name: string, prefix: string, color: 'R' | 'G', land: Card): DeckList {
  const spells = Array.from({ length: SPELLS_PER_DECK }, (_unused, index) =>
    numbered(prefix, index + 1, color),
  );
  const lands = Array.from({ length: LANDS_PER_DECK }, () => land);
  return { name, cards: [...spells, ...lands] };
}

export const MOUNTAIN = basic('Mountain', 'R', 90);
export const FOREST = basic('Forest', 'G', 91);

/**
 * The two lists, one per seat. Different colors as well as different names, so a
 * card that turns up on the wrong side of the table is visible twice over.
 */
export function twoDecks(): readonly [DeckList, DeckList] {
  return [deck('Ember', 'Ember Scout', 'R', MOUNTAIN), deck('Thorn', 'Thorn Scout', 'G', FOREST)];
}
