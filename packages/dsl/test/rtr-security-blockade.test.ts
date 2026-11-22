/** Exact authoring contract for RTR #20, Security Blockade. */
import { describe, expect, it } from 'vitest';
import { ModelAuraSchema, ModelEffectSchema, parseCard, renderOracleText } from '@mtg/dsl';

export const SECURITY_BLOCKADE_INPUT = {
  kind: 'enchantment',
  id: 'rtr-020-security-blockade',
  name: 'Security Blockade',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 20 },
  manaCost: { generic: 2, W: 1 },
  colors: ['W'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'land',
    modifications: [
      {
        kind: 'grantActivatedAbility',
        ability: {
          kind: 'activated',
          cost: { mana: {}, tapSelf: true },
          effects: [
            {
              kind: 'preventNextDamageToYouAndRetaliate',
              amount: 1,
              target: { kind: 'noTarget' },
            },
          ],
        },
      },
    ],
  },
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      printedSourceReference: 'thisAura',
      effects: [
        {
          kind: 'createToken',
          count: 1,
          token: {
            name: 'Knight',
            power: 2,
            toughness: 2,
            colors: ['W'],
            subtypes: ['Knight'],
            keywords: ['vigilance'],
          },
        },
      ],
    },
  ],
} as const;

describe('Security Blockade authoring', () => {
  it('renders exact current Oracle ordering', () => {
    expect(renderOracleText(parseCard(SECURITY_BLOCKADE_INPUT))).toBe(
      'Enchant land\nWhen this Aura enters, create a 2/2 white Knight creature token with vigilance.\nEnchanted land has "{T}: Prevent the next 1 damage that would be dealt to you this turn."',
    );
  });

  it('keeps the Aura grant and plain numeric shield outside generator output', () => {
    expect(ModelAuraSchema.safeParse(SECURITY_BLOCKADE_INPUT.aura).success).toBe(false);
    expect(
      ModelEffectSchema.safeParse(SECURITY_BLOCKADE_INPUT.aura.modifications[0].ability.effects[0]).success,
    ).toBe(false);
  });
});
