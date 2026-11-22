import { parseCard, renderOracleText } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';

describe('RTR straightforward Oracle composition', () => {
  it('prints one duration-first sentence for a pump followed by multiple shared-target keywords', () => {
    const card = parseCard({
      kind: 'instant',
      id: 'rtr-26',
      name: 'Swift Justice',
      rarity: 'common',
      set: { code: 'RTR', collectorNumber: 26 },
      colors: ['W'],
      manaCost: { W: 1 },
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: 1,
          toughness: 0,
          target: { kind: 'targetCreature' },
        },
        {
          kind: 'grantKeywordUntilEndOfTurn',
          keyword: 'firstStrike',
          additionalKeywords: ['lifelink'],
          target: { kind: 'thatCreature' },
        },
      ],
    });

    expect(renderOracleText(card)).toBe(
      'Until end of turn, target creature gets +1/+0 and gains first strike and lifelink.',
    );
  });
});
