import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText, validateCard, type CardInput } from '@mtg/dsl';

const GOLGARI_CHARM_INPUT = {
  kind: 'instant',
  id: 'rtr-164-golgari-charm-dsl',
  name: 'Golgari Charm',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 164 },
  manaCost: { B: 1, G: 1 },
  colors: ['B', 'G'],
  effects: [],
  modes: [
    {
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: -1,
          toughness: -1,
          target: { kind: 'noTarget' },
          scope: 'allPermanents',
          scopeFilter: { cardTypes: ['creature'] },
        },
      ],
    },
    {
      effects: [
        {
          kind: 'destroyPermanent',
          target: { kind: 'targetPermanent', filter: { cardTypes: ['enchantment'] } },
        },
      ],
    },
    {
      effects: [
        {
          kind: 'regeneratePermanent',
          target: { kind: 'noTarget' },
          scope: 'permanentsYouControl',
          scopeFilter: { cardTypes: ['creature'] },
        },
      ],
    },
  ],
} as unknown as CardInput;

describe('RTR #164 Golgari Charm', () => {
  it('renders all three source-attested modes in exact current Oracle order', () => {
    const card = parseCard(GOLGARI_CHARM_INPUT);

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe(
      [
        'Choose one —',
        '• All creatures get -1/-1 until end of turn.',
        '• Destroy target enchantment.',
        '• Regenerate each creature you control.',
      ].join('\n'),
    );
  });

  it('keeps scoped regeneration outside the generator output vocabulary', () => {
    const card = parseCard(GOLGARI_CHARM_INPUT);
    expect(ModelEffectSchema.safeParse(card.modes?.[2]?.effects[0]).success).toBe(false);
  });
});
