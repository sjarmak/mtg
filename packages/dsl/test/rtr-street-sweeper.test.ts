/** Street Sweeper's hand-authored land attachment sweep. */
import { AbilitySchema, ModelAbilitySchema, parseCard, renderOracleText, validateCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const ABILITY = {
  kind: 'triggered' as const,
  condition: 'selfAttacks' as const,
  printedSourceReference: 'thisCreature' as const,
  effects: [
    {
      kind: 'destroyAttachedPermanents' as const,
      target: { kind: 'targetPermanent' as const, filter: { cardTypes: ['land' as const] } },
      filter: { subtypes: ['Aura'] },
    },
  ],
};

function input(ability: unknown = ABILITY) {
  return {
    kind: 'creature',
    id: 'rtr-234-street-sweeper',
    name: 'Street Sweeper',
    rarity: 'uncommon',
    set: { code: 'RTR', collectorNumber: 234 },
    manaCost: { generic: 6 },
    artifact: true,
    subtypes: ['Construct'],
    power: 4,
    toughness: 6,
    abilities: [ability],
  };
}

describe("Street Sweeper's attached-Aura destruction", () => {
  it('parses and renders the current source Oracle exactly', () => {
    expect(validateCard(input())).toEqual([]);
    expect(renderOracleText(parseCard(input()))).toBe(
      'Whenever this creature attacks, destroy all Auras attached to target land.',
    );
  });

  it('keeps the complete attack-triggered sweep outside model output', () => {
    expect(AbilitySchema.safeParse(ABILITY).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(ABILITY).success).toBe(false);
  });

  it('admits only the reviewed target-land and Aura-filter pairing beside the existing Equipment referent', () => {
    const changed = [
      {
        ...ABILITY,
        effects: [
          {
            ...ABILITY.effects[0],
            target: { kind: 'targetPermanent' as const },
          },
        ],
      },
      {
        ...ABILITY,
        effects: [
          {
            ...ABILITY.effects[0],
            target: {
              kind: 'targetPermanent' as const,
              filter: { cardTypes: ['creature' as const] },
            },
          },
        ],
      },
      {
        ...ABILITY,
        effects: [{ ...ABILITY.effects[0], filter: { subtypes: ['Equipment'] } }],
      },
    ];

    for (const ability of changed) {
      expect(validateCard(input(ability))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'ILLEGAL_TARGET_FILTER',
            path: 'abilities[0].effects[0]',
          }),
        ]),
      );
    }
  });
});
