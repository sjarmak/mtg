/**
 * A cube that can actually be drafted: DSL cards, a rarity mix, and a curve deep
 * enough in two colors that a seat's pool builds a legal deck in them.
 *
 * `fixture-cube.ts` is store-shaped rows and is the right fixture for every
 * check that is arithmetic over a list. Availability is not one of those: it
 * runs the draft runtime and the deck builder, both of which take DSL cards, and
 * both of which have opinions a shapeless fixture cannot satisfy — 23 spells on
 * a 3/7/6/4/2/1 curve over twelve creatures, out of packs collated by rarity.
 *
 * The shape is deliberate rather than arbitrary. Two deep colors and one thin
 * one is the smallest list on which "could a seat assemble this archetype?" has
 * two different answers, which is what makes the measurement falsifiable: a
 * predicate that ignores the archetype's colors reports the same number for
 * both.
 */
import type { Card, CardInput, Color, Rarity } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { CubeCriteria, CubeCriteriaInput } from '../../src/criteria';
import { CubeCriteriaSchema } from '../../src/criteria';
import { candidateFromDslCard, setCubePool } from '../../src/set-pool';
import type { GeneratedSet } from '../../src/set-pool';
import type { CubePool } from '../../src/universe';
import type { CubeEntry } from '../../src/validate';

const SET_CODE = 'DRC';

const COLOR_WORD: Readonly<Record<Color, string>> = {
  W: 'Dawn',
  U: 'Tide',
  B: 'Ash',
  R: 'Ember',
  G: 'Bramble',
};

/**
 * Cards per mana value in one color, above `DEFAULT_TARGET_CURVE` in every
 * bucket so that one color alone over-fills the curve a deck wants. A fixture
 * sitting exactly on the target measures the fixture's curve rather than the
 * draft: every seat then misses `curveSlot` by one somewhere and availability
 * reads near zero for reasons that have nothing to do with the cube.
 */
const CURVE: readonly (readonly [number, number])[] = [
  [1, 5],
  [2, 8],
  [3, 7],
  [4, 6],
  [5, 5],
  [6, 3],
];

/** 34 cards fill one color; a thinner color takes the front of that list. */
export const CARDS_PER_FULL_COLOR = CURVE.reduce((sum, [, count]) => sum + count, 0);

/**
 * Every tenth card is rare and every fifth of the rest uncommon, so the list
 * holds all three rarities and no sheet is too thin for the pack its own
 * proportion asks for.
 */
function rarityAt(index: number): Rarity {
  if (index % 10 === 9) return 'rare';
  if (index % 5 === 4) return 'uncommon';
  return 'common';
}

/** The mana values of one color's cards, cheapest first. */
function manaValues(count: number): readonly number[] {
  return CURVE.flatMap(([manaValue, held]) => Array.from({ length: held }, () => manaValue)).slice(0, count);
}

function colorCards(color: Color, count: number, from: number, fixed?: Rarity): readonly Card[] {
  return manaValues(count).map((manaValue, index): Card => {
    const number = from + index + 1;
    return parseCard({
      kind: 'creature',
      id: `drc-${color.toLowerCase()}-${String(index + 1)}`,
      name: `${COLOR_WORD[color]} Drafter ${String(index + 1)}`,
      rarity: fixed ?? rarityAt(number - 1),
      set: { code: SET_CODE, collectorNumber: number },
      manaCost: { generic: manaValue - 1, [color]: 1 },
      colors: [color],
      subtypes: ['Scout'],
      power: manaValue,
      toughness: manaValue,
    } satisfies CardInput);
  });
}

/**
 * A land producing one color, which a cube's own list may hold.
 *
 * It carries that color's identity (CR 903.5d, the rule `candidateFromDslCard`
 * applies), so it is within that color's archetypes and would be counted by any
 * castable-card count that forgot lands are not spells. That is the whole
 * reason it exists here.
 */
function colorLand(color: Color, collectorNumber: number): Card {
  return parseCard({
    kind: 'land',
    id: `drc-${color.toLowerCase()}-reach`,
    name: `${COLOR_WORD[color]} Reach`,
    rarity: 'common',
    set: { code: SET_CODE, collectorNumber },
    producesMana: [color],
  } satisfies CardInput);
}

/** A creature no color can be blamed for, castable in every archetype. */
function colorlessCards(count: number, from: number): readonly Card[] {
  return Array.from({ length: count }, (_unused, index): Card => {
    const number = from + index + 1;
    return parseCard({
      kind: 'creature',
      id: `drc-forged-${String(index + 1)}`,
      name: `Forged Drafter ${String(index + 1)}`,
      rarity: rarityAt(number - 1),
      set: { code: SET_CODE, collectorNumber: number },
      manaCost: { generic: 3 },
      artifact: true,
      colors: [],
      subtypes: ['Construct'],
      power: 3,
      toughness: 3,
    } satisfies CardInput);
  });
}

/** Cards a fixture set carries beyond the colored creatures of its curve. */
export interface DraftableExtras {
  /** One mana-producing land per color named. */
  readonly lands?: readonly Color[];
  /** Colorless artifact creatures, which every archetype can cast. */
  readonly colorless?: number;
  /**
   * Colors printed at one rarity throughout, against the interleaved default.
   *
   * A cube is dealt from packs collated by rarity, so a color that lives in one
   * rarity is dealt at that slot's rate rather than at its share of the list.
   * A fixture whose rarities are spread evenly across its colors cannot tell
   * those two rates apart.
   */
  readonly rarities?: Partial<Record<Color, Rarity>>;
}

/** A generated set holding `counts[color]` cards in each color it names. */
export function draftableSet(
  counts: Partial<Record<Color, number>>,
  extras: DraftableExtras = {},
): GeneratedSet {
  const cards: Card[] = [];
  for (const [color, count] of Object.entries(counts)) {
    cards.push(...colorCards(color as Color, count, cards.length, extras.rarities?.[color as Color]));
  }
  cards.push(...colorlessCards(extras.colorless ?? 0, cards.length));
  for (const color of extras.lands ?? []) cards.push(colorLand(color, cards.length + 1));
  return { code: SET_CODE, name: 'Draft Reach', cards };
}

/**
 * Deep in white and blue, present in black, thin in green.
 *
 * Black is in the list but in no archetype, which is what keeps the seats from
 * all landing in the same two colors: a cube where every seat drafts the one
 * measured archetype would report availability that says nothing.
 */
export const DRAFTABLE_SET = draftableSet({
  W: CARDS_PER_FULL_COLOR,
  U: CARDS_PER_FULL_COLOR,
  B: 20,
  G: 8,
});

/**
 * Two archetypes in one pair of colors and one in a color the list barely holds.
 * The pair is deliberate: the draft cannot tell two archetypes in the same
 * colors apart, and this fixture is where that stays a stated consequence rather
 * than a surprise.
 */
export const DRAFTABLE_CRITERIA_INPUT: CubeCriteriaInput = {
  prompt: 'a cube deep in azorius and thin in green',
  format: 'modern',
  size: DRAFTABLE_SET.cards.length,
  seats: 4,
  cardsPerSeat: 45,
  archetypes: [
    { name: 'azorius control', colors: ['W', 'U'], minPlayable: 20 },
    { name: 'azorius tempo', colors: ['W', 'U'], minPlayable: 20 },
    { name: 'mono-green stompy', colors: ['G'], minPlayable: 4 },
  ],
};

export function draftableCriteria(overrides: Partial<CubeCriteriaInput> = {}): CubeCriteria {
  return CubeCriteriaSchema.parse({ ...DRAFTABLE_CRITERIA_INPUT, ...overrides });
}

/** Every card in the set, as the cube entries a finished construction produces. */
export function draftableEntries(set: GeneratedSet = DRAFTABLE_SET): readonly CubeEntry[] {
  return set.cards.map((card) => ({
    card: candidateFromDslCard(card),
    count: 1,
    archetypes: [],
    reason: 'fixture',
  }));
}

/** The pool those entries came from, which is what carries the DSL cards. */
export function draftablePool(
  set: GeneratedSet = DRAFTABLE_SET,
  criteria: CubeCriteria = draftableCriteria(),
): CubePool {
  return setCubePool(set, criteria);
}
