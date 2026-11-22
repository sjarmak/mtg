import { describe, expect, it } from 'vitest';
import type { CardInput } from '../src/index';
import { legalTargetsFor, ModelEffectSchema, parseCard, renderOracleText, validateCard } from '../src/index';

const ASSASSINS_STRIKE: CardInput = {
  kind: 'sorcery',
  id: 'rtr-assassins-strike',
  name: "Assassin's Strike",
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 57 },
  manaCost: { generic: 4, B: 2 },
  colors: ['B'],
  effects: [
    { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
    { kind: 'discardCards', count: 1, target: { kind: 'thatCreaturesController' } },
  ],
};

describe("RTR #57 Assassin's Strike", () => {
  it('uses the retained creature-controller referent and renders current Oracle exactly', () => {
    const card = parseCard(ASSASSINS_STRIKE);

    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toBe('Destroy target creature. Its controller discards a card.');
    expect(legalTargetsFor('discardCards')).toContain('thatCreaturesController');
  });

  it('keeps the hand-authored referent outside model effects', () => {
    expect(
      ModelEffectSchema.safeParse({
        kind: 'discardCards',
        count: 1,
        target: { kind: 'thatCreaturesController' },
      }).success,
    ).toBe(false);
  });
});
