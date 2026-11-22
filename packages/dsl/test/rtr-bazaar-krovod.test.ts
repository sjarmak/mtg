/** Bazaar Krovod composes an attacking target with one linked follow-up. */
import { AbilitySchema, ModelAbilitySchema, parseCard, renderOracleText, validateCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const ABILITY = {
  kind: 'triggered' as const,
  condition: 'selfAttacks' as const,
  printedSourceReference: 'thisCreature' as const,
  effects: [
    {
      kind: 'pumpUntilEndOfTurn' as const,
      power: 0,
      toughness: 2,
      target: {
        kind: 'targetCreature' as const,
        filter: { combat: 'attacking' as const },
        excludeSource: true,
      },
    },
    { kind: 'untapPermanent' as const, target: { kind: 'thatCreature' as const } },
  ],
};

describe("Bazaar Krovod's linked attack trigger", () => {
  it('parses and renders the current source Oracle exactly', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'rtr-7-bazaar-krovod',
      name: 'Bazaar Krovod',
      rarity: 'uncommon',
      set: { code: 'RTR', collectorNumber: 7 },
      manaCost: { generic: 4, W: 1 },
      colors: ['W'],
      subtypes: ['Beast'],
      power: 2,
      toughness: 5,
      abilities: [ABILITY],
    });

    expect(renderOracleText(card)).toBe(
      'Whenever this creature attacks, another target attacking creature gets +0/+2 until end of turn. Untap that creature.',
    );
  });

  it('keeps the combat filter, source exclusion, and linked untap outside model output', () => {
    expect(AbilitySchema.safeParse(ABILITY).success).toBe(true);
    expect(ModelAbilitySchema.safeParse(ABILITY).success).toBe(false);
  });

  it('admits source exclusion only on the reviewed self-attack target shape', () => {
    const card = (ability: unknown) => ({
      kind: 'creature',
      id: 'rtr-7-bazaar-krovod-boundary',
      name: 'Bazaar Krovod Boundary',
      rarity: 'uncommon',
      set: { code: 'RTR', collectorNumber: 7 },
      manaCost: { generic: 4, W: 1 },
      colors: ['W'],
      subtypes: ['Beast'],
      power: 2,
      toughness: 5,
      abilities: [ability],
    });
    const changedCondition = { ...ABILITY, condition: 'selfEnters' as const };
    const changedFilter = {
      ...ABILITY,
      effects: [
        {
          ...ABILITY.effects[0],
          target: {
            kind: 'targetCreature' as const,
            filter: { combat: 'blocking' as const },
            excludeSource: true,
          },
        },
        ABILITY.effects[1],
      ],
    };

    for (const changed of [changedCondition, changedFilter]) {
      expect(validateCard(card(changed))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'SOURCE_EXCLUSION_INVALID',
            path: 'abilities[0].effects[0].target.excludeSource',
          }),
        ]),
      );
    }
  });
});
