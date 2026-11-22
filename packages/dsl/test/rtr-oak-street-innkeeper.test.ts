/** Exact hand-authored off-turn tapped-creature grant for RTR Oak Street Innkeeper. */
import { describe, expect, it } from 'vitest';
import { ModelAbilitySchema, parseCard, renderOracleText, safeParseCard, type CardInput } from '../src/index';

export const OAK_STREET_INNKEEPER_INPUT = {
  kind: 'creature',
  id: 'rtr-131-oak-street-innkeeper',
  name: 'Oak Street Innkeeper',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 131 },
  colors: ['G'],
  manaCost: { generic: 2, G: 1 },
  subtypes: ['Elf'],
  power: 1,
  toughness: 2,
  abilities: [
    {
      kind: 'static',
      scope: 'creaturesYouControl',
      subtype: null,
      filter: { tapped: true },
      activeDuring: 'turnsOtherThanYours',
      modification: { kind: 'grantKeyword', keyword: 'hexproof' },
    },
  ],
} as const;

describe('Oak Street Innkeeper DSL', () => {
  it('renders exact current Oracle ordering outside generator output', () => {
    const card = parseCard(OAK_STREET_INNKEEPER_INPUT as unknown as CardInput);
    expect(renderOracleText(card)).toBe(
      'During turns other than yours, tapped creatures you control have hexproof.',
    );
    expect(ModelAbilitySchema.safeParse(card.abilities[0]).success).toBe(false);
  });

  it('refuses the temporal field where the replacement pipeline cannot honor it', () => {
    const invalid = safeParseCard({
      ...OAK_STREET_INNKEEPER_INPUT,
      abilities: [
        {
          kind: 'static',
          scope: 'self',
          subtype: null,
          activeDuring: 'turnsOtherThanYours',
          modification: { kind: 'doubleDamage' },
        },
      ],
    } as unknown as CardInput);
    expect(invalid.ok).toBe(false);
    if (invalid.ok) throw new Error('replacement timing gate unexpectedly validated');
    expect(invalid.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'REPLACEMENT_CONDITION_UNSUPPORTED',
          path: 'abilities[0].activeDuring',
        }),
      ]),
    );
  });
});
