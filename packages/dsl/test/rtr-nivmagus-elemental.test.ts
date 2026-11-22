/** RTR #219 as one closed spell-exile activation-cost bundle. */
import { describe, expect, it } from 'vitest';
import { ModelAbilitySchema, parseCard, renderOracleText, safeParseCard } from '@mtg/dsl';

export const NIVMAGUS_ABILITY = {
  kind: 'activated' as const,
  cost: { mana: {}, exileControlledInstantOrSorcerySpell: true as const },
  effects: [
    {
      kind: 'putCounters' as const,
      counter: 'plusOnePlusOne' as const,
      count: 2,
      target: { kind: 'selfCreature' as const },
    },
  ],
};

const INPUT = {
  kind: 'creature' as const,
  id: 'rtr-219-nivmagus-elemental',
  name: 'Nivmagus Elemental',
  rarity: 'rare' as const,
  set: { code: 'RTR', collectorNumber: 219 },
  colors: ['U' as const, 'R' as const],
  manaCost: { hybrid: { 'U/R': 1 } },
  subtypes: ['Elemental'],
  power: 1,
  toughness: 2,
  abilities: [NIVMAGUS_ABILITY],
};

describe('RTR Nivmagus Elemental DSL', () => {
  it('renders current Oracle exactly and remains outside model output', () => {
    const card = parseCard(INPUT);
    expect(renderOracleText(card)).toBe(
      "Exile an instant or sorcery spell you control: Put two +1/+1 counters on this creature. (That spell won't resolve.)",
    );
    expect(ModelAbilitySchema.safeParse(card.abilities[0]).success).toBe(false);
  });

  it('refuses independent widening of the payment and payload', () => {
    const variants = [
      { ...NIVMAGUS_ABILITY, cost: { mana: {}, exileControlledInstantOrSorcerySpell: false } },
      {
        ...NIVMAGUS_ABILITY,
        effects: [{ ...NIVMAGUS_ABILITY.effects[0], count: 1 }],
      },
      {
        ...NIVMAGUS_ABILITY,
        effects: [{ ...NIVMAGUS_ABILITY.effects[0], target: { kind: 'targetCreature' as const } }],
      },
    ];
    for (const ability of variants) {
      expect(safeParseCard({ ...INPUT, abilities: [ability] }).ok).toBe(false);
    }
  });
});
