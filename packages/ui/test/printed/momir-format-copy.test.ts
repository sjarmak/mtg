import { describe, expect, it } from 'vitest';
import type { PrintedConstructedDeck, PrintedFormatRules } from '@mtg/printed-card';
import { momirFormatCopy } from '../../src/routes/printed/momir-format-copy';

const deck: PrintedConstructedDeck = {
  id: 'momir-basic',
  name: 'Momir Basic',
  commanders: [],
  cards: ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].map((name, index) => ({
    physicalId: `m11-printed-v1:000${String(index)}:card`,
    name,
    count: 12,
  })),
};

describe('what the Momir Basic landing says about its own format', () => {
  it('states the deck size and starting life read off the rules and deck data', () => {
    const rules: PrintedFormatRules = { variant: 'momir', startingLife: 24 };
    const lines = momirFormatCopy(rules, deck);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join(' ')).toContain('60');
    expect(lines.join(' ')).toContain('24');
  });

  it('reads a different deck size off that deck rather than a hardcoded sixty', () => {
    const rules: PrintedFormatRules = { variant: 'momir', startingLife: 24 };
    const smaller: PrintedConstructedDeck = { ...deck, cards: deck.cards.slice(0, 1) };
    expect(momirFormatCopy(rules, smaller).join(' ')).toContain('12');
  });

  it('writes the avatar cost in words, because the landing draws no mana symbols', () => {
    const rules: PrintedFormatRules = { variant: 'momir', startingLife: 24 };
    const copy = momirFormatCopy(rules, deck).join(' ');
    expect(copy).not.toMatch(/[{}]/);
    expect(copy).toContain('pay X mana');
  });

  it('gives each player an avatar beside the hand, not in place of it', () => {
    const rules: PrintedFormatRules = { variant: 'momir', startingLife: 24 };
    const copy = momirFormatCopy(rules, deck).join(' ');
    expect(copy).toContain('Each player has an avatar');
    expect(copy).not.toContain('stands in for your hand');
  });

  it('says nothing for a format whose rules are not the momir variant', () => {
    const rules: PrintedFormatRules = { variant: 'standard', startingLife: 20 };
    expect(momirFormatCopy(rules, deck)).toEqual([]);
  });
});
