/**
 * What a card costs to *use* is a color the deck has to make.
 *
 * `checkColorIdentity` derives `colors` from the printed cost, and it refuses a
 * noncreature artifact whose printed cost is not colorless. So a chest that
 * opens for {1}{G} is a card the DSL calls colorless, and before this both
 * `cardColors` and `measureDemand` believed it: the builder offered it to all
 * ten pairs and built no green for it. The deck that drew it owned a blank whose
 * whole text was one line it could not pay for.
 *
 * Equip is the shape a real generated set already prints — `out/XMP-equip`
 * carries five attach abilities — and it needs no arm of its own, because an
 * equip clause is an activated ability carrying `attach` (`AbilitySchema`).
 * That is asserted here rather than assumed.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { Color } from '@mtg/dsl';
import {
  cardColors,
  DEFAULT_SCORE_WEIGHTS,
  evaluatePool,
  measureDemand,
  resolveConfig,
} from '@mtg/deckbuild';

const CONFIG = resolveConfig();

type ManaCostInput = Record<'generic' | Color, number>;

const NO_COST: ManaCostInput = { generic: 0, W: 0, U: 0, B: 0, R: 0, G: 0 };

/** An artifact whose printed cost is colorless and whose ability is not. */
function chest(cost: Partial<ManaCostInput>): Card {
  return parseCard({
    kind: 'artifact',
    id: 'ac-chest',
    name: 'Sealed Chest',
    rarity: 'common',
    set: { code: 'ACT', collectorNumber: 1 },
    manaCost: { generic: 2 },
    colors: [],
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { ...NO_COST, ...cost } },
        effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
      },
    ],
  } satisfies CardInput);
}

describe('a colored activation cost is part of a card colors', () => {
  it('reads the color off an artifact whose printed cost cannot carry it', () => {
    expect(cardColors(chest({ generic: 1, G: 1 }))).toEqual(['G']);
  });

  /**
   * The guard against widening the union with something looser than
   * `colorsFromCost`: generic mana is not a color and must not become one, or
   * every card in the set turns five-colored and the first assertion passes for
   * the wrong reason.
   */
  it('leaves a card whose activation is purely generic exactly as printed', () => {
    expect(cardColors(chest({ generic: 3 }))).toEqual([]);
  });

  /**
   * Equip needs no arm of its own. If this goes red while the chest cases stay
   * green, someone has narrowed the activated arm to exclude `attach`.
   */
  it('counts an equip cost, which is an activated ability carrying attach', () => {
    const sword = parseCard({
      kind: 'artifact',
      id: 'ac-sword',
      name: 'Borrowed Blade',
      rarity: 'uncommon',
      set: { code: 'ACT', collectorNumber: 2 },
      manaCost: { generic: 2 },
      colors: [],
      subtypes: ['Equipment'],
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { ...NO_COST, generic: 2, W: 1 } },
          attach: { modifications: [{ kind: 'statBonus', power: 2, toughness: 0 }] },
          effects: [],
        },
      ],
    } satisfies CardInput);
    expect(cardColors(sword)).toEqual(['W']);
  });
});

describe('the mana base counts the color an ability is paid in', () => {
  it('files the activation requirement at the turn both halves are affordable', () => {
    const demand = measureDemand(
      evaluatePool([chest({ generic: 1, G: 1 })], DEFAULT_SCORE_WEIGHTS),
      CONFIG.manaBase,
    );
    expect(demand.G.pipCount).toBe(1);
    // 2 to cast plus 2 to open. Filed at spell.manaValue alone this is 2, which
    // is the mutation this assertion exists to catch.
    expect(demand.G.earliest?.manaValue).toBe(4);
  });

  it('reports no demand for a color no cost on the card mentions', () => {
    const demand = measureDemand(
      evaluatePool([chest({ generic: 1, G: 1 })], DEFAULT_SCORE_WEIGHTS),
      CONFIG.manaBase,
    );
    expect(demand.R.pipCount).toBe(0);
    expect(demand.R.earliest).toBeUndefined();
  });
});
