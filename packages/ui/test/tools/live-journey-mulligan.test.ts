/**
 * `mtg-43j03`: the live journey's Commander cast step failed on luck when a
 * kept seven never reached four lands before the Forge bot won. The keep rule
 * this covers is what `live-journey.ts`'s `OPEN_AND_KEEP` in-page script embeds
 * by value and by regex source, so a change here is a change there too.
 */
import { describe, expect, it } from 'vitest';
import {
  isLandLabel,
  landCount,
  MAX_MULLIGANS,
  MIN_LANDS_TO_KEEP,
  shouldMulligan,
} from '../../tools/live-journey-mulligan';

const swamp = 'Swamp. Basic Land — Swamp. {T}: Add {B}.';
const mountain = 'Mountain. Basic Land — Mountain. {T}: Add {R}.';
const landTax = 'Land Tax. Mana cost {W}. Enchantment.';
const bolt = 'Lightning Bolt. Mana cost {R}. Instant.';
const spell = (n: number): string => `Spell ${String(n)}. Mana cost {1}. Sorcery.`;

describe('isLandLabel', () => {
  it('matches a basic land by its type line', () => {
    expect(isLandLabel(swamp)).toBe(true);
  });

  it('does not match a spell named after a land type through its own name', () => {
    expect(isLandLabel(landTax)).toBe(false);
  });

  it('does not match a nonland spell', () => {
    expect(isLandLabel(bolt)).toBe(false);
  });
});

describe('landCount', () => {
  it('counts only the land labels in a hand', () => {
    const hand = [swamp, mountain, landTax, bolt, spell(1)];
    expect(landCount(hand)).toBe(2);
  });
});

describe('shouldMulligan', () => {
  it('mulligans a seven with two lands on the first keep decision', () => {
    const hand = [swamp, mountain, spell(1), spell(2), spell(3), spell(4), spell(5)];
    expect(landCount(hand)).toBeLessThan(MIN_LANDS_TO_KEEP);
    expect(shouldMulligan(hand, 0)).toBe(true);
  });

  it('keeps a seven that already holds three lands', () => {
    const hand = [swamp, mountain, swamp, spell(1), spell(2), spell(3), spell(4)];
    expect(landCount(hand)).toBe(MIN_LANDS_TO_KEEP);
    expect(shouldMulligan(hand, 0)).toBe(false);
  });

  it('keeps a hand with no lands at all once the mulligan budget is spent', () => {
    const hand = [spell(1), spell(2), spell(3), spell(4), spell(5)];
    expect(shouldMulligan(hand, MAX_MULLIGANS)).toBe(false);
  });

  it('still mulligans a screwed hand on the last mulligan the budget allows', () => {
    const hand = [spell(1), spell(2), spell(3), spell(4), spell(5), spell(6)];
    expect(shouldMulligan(hand, MAX_MULLIGANS - 1)).toBe(true);
  });
});
