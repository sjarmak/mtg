/**
 * `countWithCounter`: a quantity read off the counters sitting on permanents.
 *
 * Two things in this vocabulary already read a counter and neither counts one.
 * `withCounter` (`targets.ts`) names one permanent by a counter it carries and
 * `anyCreatureHasCounter` (`condition.ts`) asks whether one exists anywhere on
 * the battlefield; both are presence checks, and a payoff card is a count. This
 * file asserts the shape of the ninth computed amount and the two frames it
 * prints in — "the number of … you control with a … counter on them" for a
 * one-shot quantity, and "for each … you control with a … counter on it" for
 * the CR 613 rate `statBonusPer` charges.
 *
 * The list is the half worth asserting hardest. Every other counter-reading
 * shape in this package names exactly one kind because exactly one kind was
 * asked for; this one names as many as the card does, because a mechanic built
 * out of five differently-named counters has no single kind to name and no
 * grouping in `COUNTER_DECLARATIONS` to name instead.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card, CardInput, ComputedAmount } from '../src/index';
import { AmountSchema, PermanentTallySchema, renderOracleText, validateCard } from '../src/index';
import { parseCard } from '../src/parse';

/** The five counters this set calls parts, as one card reads them. */
const PARTS = ['fang', 'hide', 'horn', 'talon', 'wing'] as const;

const PART_BEARERS: ComputedAmount = {
  kind: 'countWithCounter',
  filter: { cardTypes: ['creature'] },
  counters: [...PARTS],
};

const ARMORY: AbilityInput = {
  kind: 'static',
  scope: 'creaturesYouControl',
  modification: { kind: 'statBonusPer', power: 1, toughness: 1, each: PART_BEARERS },
};

function artifactInput(abilities: readonly AbilityInput[]): Record<string, unknown> {
  return {
    kind: 'artifact',
    id: 'xmp-count-with-counter-probe',
    name: 'Rack of Trophies',
    rarity: 'rare',
    set: { code: 'XMP', collectorNumber: 311 },
    manaCost: { generic: 3 },
    colors: [],
    supertypes: [],
    subtypes: [],
    keywords: [],
    effects: [],
    abilities: [...abilities],
  };
}

describe('an amount counted off the counters on a board', () => {
  it('parses as a computed amount and as a CR 613 tally', () => {
    expect(AmountSchema.parse(PART_BEARERS)).toEqual(PART_BEARERS);
    expect(PermanentTallySchema.parse(PART_BEARERS)).toEqual(PART_BEARERS);
  });

  /**
   * A list of no counters is a card that counts everything or nothing depending
   * on which reader answers it, so the schema refuses it rather than leaving
   * the question to a validator downstream.
   */
  it('refuses a card that names no counter at all', () => {
    expect(AmountSchema.safeParse({ ...PART_BEARERS, counters: [] }).success).toBe(false);
  });

  it('prints the rate as a per-permanent count in the singular', () => {
    const card: Card = parseCard(artifactInput([ARMORY]) as CardInput);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'Creatures you control get +1/+1 for each creature you control with a fang, hide, horn, talon, or wing counter on it.',
    );
  });

  it('prints a one-shot quantity in the plural frame', () => {
    const card: Card = parseCard({
      kind: 'sorcery',
      id: 'xmp-count-with-counter-spell-probe',
      name: 'Tally the Rack',
      rarity: 'uncommon',
      set: { code: 'XMP', collectorNumber: 312 },
      manaCost: { generic: 2, R: 1 },
      colors: ['R'],
      supertypes: [],
      subtypes: [],
      keywords: [],
      abilities: [],
      effects: [
        {
          kind: 'dealDamage',
          amount: { kind: 'countWithCounter', filter: {}, counters: ['horn'] },
          target: { kind: 'targetOpponent' },
        },
      ],
    } as unknown as CardInput);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      'Tally the Rack deals damage to target opponent equal to the number of permanents you control with a horn counter on them.',
    );
  });
});
