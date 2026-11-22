import { describe, expect, it } from 'vitest';
import { parseCard, renderOracleText, type CardInput } from '@mtg/dsl';

const SELESNYA_CHARM = {
  kind: 'instant',
  id: 'rtr-194-selesnya-charm',
  name: 'Selesnya Charm',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 194 },
  manaCost: { G: 1, W: 1 },
  colors: ['G', 'W'],
  effects: [],
  modes: [
    {
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: 2,
          toughness: 2,
          keyword: 'trample',
          target: { kind: 'targetCreature' },
        },
      ],
    },
    {
      effects: [
        {
          kind: 'exileTarget',
          target: { kind: 'targetCreature', restriction: { kind: 'minPower', power: 5 } },
        },
      ],
    },
    {
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
} as unknown as CardInput;

describe('RTR #194 Selesnya Charm', () => {
  it('parses as three independent modes and renders current Oracle exactly', () => {
    const card = parseCard(SELESNYA_CHARM);

    expect(card.effects).toEqual([]);
    expect(card.modes).toHaveLength(3);
    expect(renderOracleText(card)).toBe(
      [
        'Choose one —',
        '• Target creature gets +2/+2 and gains trample until end of turn.',
        '• Exile target creature with power 5 or greater.',
        '• Create a 2/2 white Knight creature token with vigilance.',
      ].join('\n'),
    );
  });
});
