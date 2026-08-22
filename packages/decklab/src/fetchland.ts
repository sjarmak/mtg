/**
 * What a fetchland finds, as data rather than as a reading of its oracle text.
 *
 * A fetchland taps for nothing, so Scryfall gives it no `produced_mana` and the
 * mana base counted four Arid Mesa as four blanks — a Boros build with eleven
 * real white sources reported eight and raised a shortfall against a mana base
 * that was fine. What the fetch supplies is derivable from the deck: the card
 * names two land types, and the deck's own lands carry those types. But the
 * naming happens in free oracle text, and pattern-matching meaning out of card
 * text is the one thing the ZFC rule forbids the code to do, so the naming is
 * held here instead, as a table a reader can check against the printed cards.
 *
 * ## Where the list came from
 *
 * Every land in the ingested store (38,623 oracle cards) whose oracle text
 * contains both "Search your library" and "Sacrifice", read by hand:
 *
 *     SELECT name, type_line, oracle_text FROM oracle_card
 *     WHERE source = 'scryfall' AND type_line LIKE '%Land%'
 *       AND oracle_text LIKE '%Search your library%'
 *       AND oracle_text LIKE '%Sacrifice%' ORDER BY name;
 *
 * That query returns 59 rows. An entry is kept when all three hold, and the
 * three are the whole rule:
 *
 * 1. the search is for a **land** and puts it **onto the battlefield** — which
 *    drops Urza's Saga, Inventors' Fair, Sanctum of Ugin, Axgard Armory, The
 *    World Tree and Maelstrom of the Spirit Dragon, none of which fetch lands;
 * 2. the search **names land types**, so a color follows from it — which drops
 *    Urza's Cave, whose "a land card" this table has no way to express;
 * 3. the search costs **no mana**: tapping, sacrificing and paying life only.
 *    A land that has to be paid for is not a source on the turn a castability
 *    check asks about it, so the five Panoramas, Krosan Verge, Warped Landscape,
 *    Terminal Moraine, Shire Terrace, Promising Vein, Blighted Woodland and
 *    Myriad Landscape are deliberately absent. They will read as zero sources,
 *    which is the conservative direction and the one to revisit knowingly.
 *
 * Demolition Field fails (1): its search rides on destroying an opponent's
 * nonbasic land, so it is conditional on the board rather than on the deck.
 * Lander is a token, not a card anyone can put in a deck.
 *
 * ## What a fetch is worth
 *
 * One source per color it can reach, exactly like a dual — the same
 * simplification the mana base already makes for a tapland, which counts in full
 * despite arriving a turn late. A card that finds two lands at once still counts
 * once, which understates it and is the safer error.
 */
import type { BasicLandType, Color } from '@mtg/dsl';
import { BASIC_LAND_COLOR, BASIC_LAND_TYPES } from '@mtg/dsl';
import { normalizeName } from './candidates';

export interface FetchTargets {
  /** The land types the search names. */
  readonly types: readonly BasicLandType[];
  /** True when the search is restricted to basic lands, so no dual satisfies it. */
  readonly basicsOnly: boolean;
}

interface FetchGroup extends FetchTargets {
  readonly names: readonly string[];
}

/**
 * The printed fetchlands, grouped by what they search for. Grouping is not
 * decoration: these are printed as cycles, and a cycle read as one row is a
 * cycle a reader can check against the cards in one pass.
 */
const FETCH_GROUPS: readonly FetchGroup[] = [
  // Onslaught and Zendikar: "{T}, Pay 1 life, Sacrifice this land: Search your
  // library for a <type> or <type> card". Any card with the type, so a shockland
  // or a Dryad Arbor answers them, not only a basic.
  { types: ['Mountain', 'Plains'], basicsOnly: false, names: ['Arid Mesa'] },
  { types: ['Swamp', 'Mountain'], basicsOnly: false, names: ['Bloodstained Mire'] },
  { types: ['Plains', 'Island'], basicsOnly: false, names: ['Flooded Strand'] },
  { types: ['Plains', 'Swamp'], basicsOnly: false, names: ['Marsh Flats'] },
  { types: ['Forest', 'Island'], basicsOnly: false, names: ['Misty Rainforest'] },
  { types: ['Island', 'Swamp'], basicsOnly: false, names: ['Polluted Delta'] },
  { types: ['Island', 'Mountain'], basicsOnly: false, names: ['Scalding Tarn'] },
  { types: ['Swamp', 'Forest'], basicsOnly: false, names: ['Verdant Catacombs'] },
  { types: ['Forest', 'Plains'], basicsOnly: false, names: ['Windswept Heath'] },
  { types: ['Mountain', 'Forest'], basicsOnly: false, names: ['Wooded Foothills'] },

  // Mirage: the same search behind an enters-tapped clause and no life.
  { types: ['Island', 'Swamp'], basicsOnly: false, names: ['Bad River'] },
  { types: ['Plains', 'Island'], basicsOnly: false, names: ['Flood Plain'] },
  { types: ['Forest', 'Plains'], basicsOnly: false, names: ['Grasslands'] },
  { types: ['Mountain', 'Forest'], basicsOnly: false, names: ['Mountain Valley'] },
  { types: ['Swamp', 'Mountain'], basicsOnly: false, names: ['Rocky Tar Pit'] },

  // Streets of New Capenna: sacrificed on entry, three basics, gain a life.
  { types: ['Forest', 'Plains', 'Island'], basicsOnly: true, names: ['Brokers Hideout'] },
  { types: ['Mountain', 'Forest', 'Plains'], basicsOnly: true, names: ['Cabaretti Courtyard'] },
  { types: ['Island', 'Swamp', 'Mountain'], basicsOnly: true, names: ['Maestros Theater'] },
  { types: ['Plains', 'Island', 'Swamp'], basicsOnly: true, names: ['Obscura Storefront'] },
  { types: ['Swamp', 'Mountain', 'Forest'], basicsOnly: true, names: ['Riveteers Overlook'] },

  // The Landscape cycle: three basics, and a cycling cost that is not the search.
  { types: ['Forest', 'Island', 'Mountain'], basicsOnly: true, names: ['Bountiful Landscape'] },
  { types: ['Plains', 'Island', 'Swamp'], basicsOnly: true, names: ['Contaminated Landscape'] },
  { types: ['Plains', 'Swamp', 'Forest'], basicsOnly: true, names: ['Deceptive Landscape'] },
  { types: ['Swamp', 'Forest', 'Island'], basicsOnly: true, names: ['Foreboding Landscape'] },
  { types: ['Island', 'Mountain', 'Plains'], basicsOnly: true, names: ['Perilous Landscape'] },
  { types: ['Island', 'Swamp', 'Mountain'], basicsOnly: true, names: ['Seething Landscape'] },
  { types: ['Mountain', 'Plains', 'Swamp'], basicsOnly: true, names: ['Shattered Landscape'] },
  { types: ['Mountain', 'Forest', 'Plains'], basicsOnly: true, names: ['Sheltering Landscape'] },
  { types: ['Forest', 'Plains', 'Island'], basicsOnly: true, names: ['Tranquil Landscape'] },
  { types: ['Swamp', 'Mountain', 'Forest'], basicsOnly: true, names: ['Twisted Landscape'] },

  // "A basic land card": every type, and nothing but a basic.
  {
    types: BASIC_LAND_TYPES,
    basicsOnly: true,
    names: [
      'Elven Passage',
      'Escape Tunnel',
      'Evolving Wilds',
      'Fabled Passage',
      'Hobbit Hole',
      'Prismatic Vista',
      'Terramorphic Expanse',
      'Vibrant Cityscape',
    ],
  },
];

const FETCH_TARGETS: ReadonlyMap<string, FetchTargets> = new Map(
  FETCH_GROUPS.flatMap((group) =>
    group.names.map(
      (name) => [normalizeName(name), { types: group.types, basicsOnly: group.basicsOnly }] as const,
    ),
  ),
);

/** What this card searches for, or `undefined` when it is not a fetchland. */
export function fetchTargets(cardName: string): FetchTargets | undefined {
  return FETCH_TARGETS.get(normalizeName(cardName));
}

/** How many fetchlands the table holds; the tests assert against it. */
export const FETCHLAND_COUNT = FETCH_TARGETS.size;

/**
 * The basic land types printed on a card, from Scryfall's type line.
 *
 * Splitting a type line on its em dash is reading a structured field, not
 * detecting meaning in prose: Scryfall's grammar puts supertypes and card types
 * before the dash and subtypes after it, always. Only the five basic land types
 * are returned, because those are the only ones a fetch names and the only ones
 * that carry a color. Dryad Arbor's `Land Creature — Forest Dryad` is a Forest
 * by this reading, which is exactly what a Misty Rainforest can find.
 */
export function basicLandTypesOf(typeLine: string): readonly BasicLandType[] {
  const subtypes = typeLine.split('—')[1];
  if (subtypes === undefined) return [];
  const printed = new Set(subtypes.split(/\s+/));
  return BASIC_LAND_TYPES.filter((type) => printed.has(type));
}

/** The color a basic of this land type taps for. */
export function colorOfBasicType(type: BasicLandType): Color {
  return BASIC_LAND_COLOR[type];
}
