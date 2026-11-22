/** Trostani's event-retained toughness amount stays executable but outside generation. */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, CardInput, EffectInput } from '../src/index';
import {
  ComputedAmountSchema,
  ModelEffectSchema,
  SharedComputedAmountSchema,
  TRIGGERING_CREATURE_CONDITIONS,
  renderOracleText,
} from '../src/index';
import { parseCard } from '../src/parse';

const TRIGGERING_TOUGHNESS = { kind: 'triggeringCreatureToughness' } as const;

const GAIN_TOUGHNESS: EffectInput = {
  kind: 'gainLife',
  amount: TRIGGERING_TOUGHNESS,
  target: { kind: 'noTarget' },
};

const TROSTANI_TRIGGER: AbilityInput = {
  kind: 'triggered',
  condition: 'anotherControlledCreatureEnters',
  effects: [GAIN_TOUGHNESS],
};

function trostani(abilities: readonly AbilityInput[] = [TROSTANI_TRIGGER]): CardInput {
  return {
    kind: 'creature',
    id: 'rtr-206-trostani-selesnyas-voice',
    name: "Trostani, Selesnya's Voice",
    rarity: 'mythic',
    set: { code: 'RTR', collectorNumber: 206 },
    manaCost: { G: 2, W: 2 },
    colors: ['G', 'W'],
    supertypes: ['legendary'],
    subtypes: ['Dryad'],
    power: 2,
    toughness: 5,
    keywords: [],
    abilities: [...abilities],
  };
}

describe("Trostani's triggering-creature toughness amount", () => {
  it('is engine-only and the controlled-creature entry event retains its referent', () => {
    expect(TRIGGERING_CREATURE_CONDITIONS).toContain('anotherControlledCreatureEnters');
    expect(ComputedAmountSchema.parse(TRIGGERING_TOUGHNESS)).toEqual(TRIGGERING_TOUGHNESS);
    expect(SharedComputedAmountSchema.safeParse(TRIGGERING_TOUGHNESS).success).toBe(false);
    expect(ModelEffectSchema.safeParse(GAIN_TOUGHNESS).success).toBe(false);
  });

  it('renders the event-derived quantity as the creature toughness clause', () => {
    expect(renderOracleText(parseCard(trostani()))).toContain(
      "you gain life equal to that creature's toughness.",
    );
  });

  it('refuses the amount on triggers without a retained creature', () => {
    expect(() =>
      parseCard(
        trostani([
          {
            ...TROSTANI_TRIGGER,
            condition: 'selfEnters',
          },
        ]),
      ),
    ).toThrow(/triggeringCreatureToughness/u);
  });

  it('refuses the amount on activated abilities and spells', () => {
    expect(() =>
      parseCard(
        trostani([
          {
            kind: 'activated',
            cost: { mana: { generic: 1 } },
            effects: [GAIN_TOUGHNESS],
          },
        ]),
      ),
    ).toThrow(/triggeringCreatureToughness/u);

    expect(() =>
      parseCard({
        kind: 'instant',
        id: 'tst-stolen-toughness',
        name: 'Stolen Toughness',
        rarity: 'rare',
        set: { code: 'TST', collectorNumber: 1 },
        manaCost: { generic: 1, W: 1 },
        colors: ['W'],
        effects: [GAIN_TOUGHNESS],
      }),
    ).toThrow(/triggeringCreatureToughness/u);
  });
});
