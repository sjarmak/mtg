/** Mercurial Chemister's paid-discard mana value remains engine-only. */
import { ModelEffectSchema, parseCard, renderOracleText, type CardInput } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

const DAMAGE = {
  kind: 'dealDamage' as const,
  amount: { kind: 'paidDiscardManaValue' as const },
  target: { kind: 'targetCreature' as const },
};

const CHEMISTER = {
  kind: 'creature' as const,
  id: 'rtr-180-mercurial-chemister',
  name: 'Mercurial Chemister',
  rarity: 'rare' as const,
  set: { code: 'RTR', collectorNumber: 180 },
  colors: ['U', 'R'],
  manaCost: { generic: 3, U: 1, R: 1 },
  subtypes: ['Human', 'Wizard'],
  power: 2,
  toughness: 3,
  abilities: [
    {
      kind: 'activated' as const,
      cost: { mana: { U: 1 }, tapSelf: true },
      effects: [{ kind: 'drawCards' as const, count: 2, target: { kind: 'noTarget' as const } }],
    },
    {
      kind: 'activated' as const,
      printedSourceReference: 'thisCreature' as const,
      cost: { mana: { R: 1 }, tapSelf: true, discard: 1 },
      effects: [DAMAGE],
    },
  ],
};

describe('Mercurial Chemister DSL', () => {
  it('renders the exact current Oracle order', () => {
    expect(renderOracleText(parseCard(CHEMISTER as CardInput))).toBe(
      [
        '{U}, {T}: Draw two cards.',
        "{R}, {T}, Discard a card: This creature deals damage to target creature equal to the discarded card's mana value.",
      ].join('\n'),
    );
  });

  it('requires exactly one discarded card in the cost', () => {
    for (const discard of [undefined, 2] as const) {
      expect(() =>
        parseCard({
          ...CHEMISTER,
          abilities: [
            CHEMISTER.abilities[0],
            {
              ...CHEMISTER.abilities[1],
              cost: { mana: { R: 1 }, tapSelf: true, ...(discard === undefined ? {} : { discard }) },
            },
          ],
        } as CardInput),
      ).toThrow(/paid-discard-mana-value|exactly one card/iu);
    }
  });

  it('keeps the retained cost amount outside generator output', () => {
    expect(ModelEffectSchema.safeParse(DAMAGE).success).toBe(false);
  });
});
