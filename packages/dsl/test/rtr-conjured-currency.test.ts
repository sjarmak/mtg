/** Conjured Currency's closed source-and-target control exchange. */
import { describe, expect, it } from 'vitest';
import { ModelAbilitySchema, parseCard, renderOracleText, safeParseCard } from '../src/index';

export const CONJURED_CURRENCY = {
  kind: 'enchantment',
  id: 'rtr-33-conjured-currency',
  name: 'Conjured Currency',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 33 },
  manaCost: { generic: 5, U: 1 },
  colors: ['U'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'beginningOfYourUpkeep',
      optional: true,
      effects: [
        {
          kind: 'exchangeControl',
          exchangeSource: true,
          target: { kind: 'targetPermanentYouNeitherOwnNorControl' },
        },
      ],
    },
  ],
} as const;

describe('Conjured Currency DSL', () => {
  it('renders the exact current Oracle text and stays outside the model', () => {
    const card = parseCard(CONJURED_CURRENCY);
    expect(renderOracleText(card)).toBe(
      'At the beginning of your upkeep, you may exchange control of this enchantment and target permanent you neither own nor control.',
    );
    expect(ModelAbilitySchema.safeParse(card.abilities[0]).success).toBe(false);
  });

  it.each([
    { exchangeSource: undefined },
    { exchangeSource: true, target: { kind: 'targetPermanent' } },
    {
      exchangeSource: true,
      target: { kind: 'targetPermanentYouNeitherOwnNorControl', count: 2, minimum: 2 },
    },
  ])('refuses a widened exchange-source envelope %#', (change) => {
    const ability = CONJURED_CURRENCY.abilities[0];
    const effect = { ...ability.effects[0], ...change };
    const result = safeParseCard({
      ...CONJURED_CURRENCY,
      abilities: [{ ...ability, effects: [effect] }],
    });
    expect(result.ok).toBe(false);
  });

  it.each([
    { condition: 'beginningOfYourEndStep' },
    { optional: undefined },
    { effects: [...CONJURED_CURRENCY.abilities[0].effects, { kind: 'drawCards', count: 1 }] },
  ])('keeps the source exchange in its exact upkeep bundle %#', (change) => {
    const result = safeParseCard({
      ...CONJURED_CURRENCY,
      abilities: [{ ...CONJURED_CURRENCY.abilities[0], ...change }],
    });
    expect(result.ok).toBe(false);
  });
});
