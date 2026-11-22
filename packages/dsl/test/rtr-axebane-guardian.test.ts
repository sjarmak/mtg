/** RTR #115 as one closed, counted any-color-combination mana capability. */
import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText, safeParseCard } from '@mtg/dsl';

export const AXEBANE_MANA = {
  kind: 'addMana' as const,
  produces: ['W', 'U', 'B', 'R', 'G'] as const,
  amount: {
    kind: 'countMatching' as const,
    filter: { cardTypes: ['creature' as const], keywordAbilities: ['defender' as const] },
  },
  distribution: 'anyCombinationOfColors' as const,
};

const INPUT = {
  kind: 'creature' as const,
  id: 'rtr-115-axebane-guardian',
  name: 'Axebane Guardian',
  rarity: 'common' as const,
  set: { code: 'RTR', collectorNumber: 115 },
  colors: ['G' as const],
  manaCost: { generic: 2, G: 1 },
  subtypes: ['Human', 'Druid'],
  keywordAbilities: [{ kind: 'defender' as const }],
  power: 0,
  toughness: 3,
  abilities: [
    {
      kind: 'activated' as const,
      cost: { mana: {}, tapSelf: true },
      effects: [AXEBANE_MANA],
    },
  ],
};

describe('RTR Axebane Guardian DSL', () => {
  it('renders current Oracle exactly and remains outside model output', () => {
    const card = parseCard(INPUT);
    expect(renderOracleText(card)).toBe(
      'Defender\n{T}: Add X mana in any combination of colors, where X is the number of creatures you control with defender.',
    );
    const ability = card.abilities[0];
    expect(ability?.kind).toBe('activated');
    if (ability?.kind !== 'activated') throw new Error('Axebane mana ability did not parse as activated');
    expect(ModelEffectSchema.safeParse(ability.effects[0]).success).toBe(false);
  });

  it('refuses independently widened distribution, color, and count parameters', () => {
    const variants = [
      { ...AXEBANE_MANA, produces: ['W', 'U', 'B', 'R'] },
      { ...AXEBANE_MANA, amount: 2 },
      {
        ...AXEBANE_MANA,
        amount: { kind: 'countMatching', filter: { cardTypes: ['creature'] } },
      },
      { ...AXEBANE_MANA, distribution: 'anyOneColor' },
    ];
    for (const effect of variants) {
      expect(
        safeParseCard({
          ...INPUT,
          abilities: [{ ...INPUT.abilities[0], effects: [effect] }],
        }).ok,
      ).toBe(false);
    }
  });
});
