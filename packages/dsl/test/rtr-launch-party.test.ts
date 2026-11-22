import { describe, expect, it } from 'vitest';
import { ModelEffectSchema, parseCard, renderOracleText, type CardInput } from '@mtg/dsl';

const LAUNCH_PARTY = {
  kind: 'instant',
  id: 'rtr-69-launch-party',
  name: 'Launch Party',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 69 },
  manaCost: { generic: 3, B: 1 },
  colors: ['B'],
  additionalCost: {
    sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } },
  },
  effects: [
    { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
    { kind: 'loseLife', amount: 2, target: { kind: 'thatCreaturesController' } },
  ],
} as unknown as CardInput;

describe('RTR #69 Launch Party', () => {
  it('parses and renders the current Oracle text exactly', () => {
    expect(renderOracleText(parseCard(LAUNCH_PARTY))).toBe(
      [
        'As an additional cost to cast this spell, sacrifice a creature.',
        'Destroy target creature. Its controller loses 2 life.',
      ].join('\n'),
    );
  });

  it('keeps the retained controller projection outside model effects', () => {
    const card = parseCard(LAUNCH_PARTY);
    if (card.kind !== 'instant') throw new Error('Launch Party did not parse as an instant');

    expect(card.additionalCost).toEqual({
      sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } },
    });
    expect(ModelEffectSchema.safeParse(card.effects[1]).success).toBe(false);
  });
});
