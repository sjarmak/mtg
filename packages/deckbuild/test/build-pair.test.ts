import { describe, expect, it } from 'vitest';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import {
  buildDeckForPair,
  colorPairKey,
  COLOR_PAIRS,
  hasShortfall,
  isPlayableIn,
  PairDeckError,
} from '../src/index';

const WU = COLOR_PAIRS.find((pair) => colorPairKey(pair) === 'WU');
if (WU === undefined) throw new Error('COLOR_PAIRS is missing WU');

describe('buildDeckForPair', () => {
  it('returns a deck in the requested pair, not the pool-best pair', () => {
    for (const pair of COLOR_PAIRS) {
      const result = buildDeckForPair(EXAMPLE_CARDS, pair);
      expect(colorPairKey(result.colorPair)).toBe(colorPairKey(pair));
    }
  });

  it('takes only cards playable in the pair', () => {
    const result = buildDeckForPair(EXAMPLE_CARDS, WU);
    for (const card of result.spells) {
      expect(isPlayableIn(card, WU)).toBe(true);
    }
  });

  it('plays each pool card at most once, so a thin pool yields a short deck', () => {
    const result = buildDeckForPair(EXAMPLE_CARDS, WU);
    const spellIds = result.spells.map((card) => card.id);
    expect(new Set(spellIds).size).toBe(spellIds.length);
    // EXAMPLE_CARDS is a 16-card DSL demonstration, not a draftable set: it
    // cannot fill 23 spell slots without duplication, and the builder correctly
    // reports the gap instead of padding.
    expect(result.deck.length).toBeLessThan(result.config.deckSize);
    expect(result.complete).toBe(false);
    expect(hasShortfall(result.shortfalls, 'spellSlots')).toBe(true);
  });

  it('is deterministic for a fixed pool and pair', () => {
    const first = buildDeckForPair(EXAMPLE_CARDS, WU);
    const second = buildDeckForPair(EXAMPLE_CARDS, WU);
    expect(second.deck.map((card) => card.id)).toEqual(first.deck.map((card) => card.id));
  });

  it('forwards config overrides to the underlying builder', () => {
    const result = buildDeckForPair(EXAMPLE_CARDS, WU, { minCreatures: 1 });
    expect(result.config.minCreatures).toBe(1);
  });

  it('throws PairDeckError naming the pair when no card is playable in it', () => {
    const monoGreen = EXAMPLE_CARDS.filter(
      (card) => card.kind !== 'land' && card.colors.length === 1 && card.colors[0] === 'G',
    );
    expect(monoGreen.length).toBeGreaterThan(0);
    const wu = () => buildDeckForPair(monoGreen, WU);
    expect(wu).toThrow(PairDeckError);
    expect(wu).toThrow(/playable in WU/);
  });
});
