import { describe, expect, it } from 'vitest';
import { COLOR_PAIRS, colorPairKey, isPlayableIn } from '@mtg/deckbuild';
import { isLand } from '@mtg/dsl';
import type { SliceStageError } from '@mtg/slice';
import { runDeckStage } from '@mtg/slice';
import { recordedCards } from './helpers';

describe('the deck-construction stage', () => {
  it('turns the generated set into one legal deck per color pair', async () => {
    const cards = await recordedCards();
    const result = runDeckStage(cards);

    expect(result.decks).toHaveLength(COLOR_PAIRS.length);
    expect(result.decks.map((deck) => deck.key)).toStrictEqual(COLOR_PAIRS.map(colorPairKey));
    for (const deck of result.decks) {
      expect(deck.deck.cards, `${deck.key} is not a 40-card deck`).toHaveLength(40);
      expect(deck.deck.name).toBe(deck.key);
      expect(deck.deck.cards.filter(isLand)).toHaveLength(17);
      expect(deck.creatureCount).toBeGreaterThan(0);
    }
  });

  it('keeps every spell inside the deck it was built for', async () => {
    const cards = await recordedCards();
    for (const deck of runDeckStage(cards).decks) {
      for (const card of deck.deck.cards) {
        if (isLand(card)) continue;
        expect(isPlayableIn(card, deck.pair), `${card.name} is off-color in ${deck.key}`).toBe(true);
      }
    }
  });

  it('writes a human-readable report per deck', async () => {
    const cards = await recordedCards();
    const first = runDeckStage(cards).decks[0];
    expect(first?.report).toContain('Mana base');
  });

  it('fails, attributed, when the pool cannot fill a deck', async () => {
    const cards = await recordedCards();
    const whiteOnly = cards.filter((card) => card.colors.length === 1 && card.colors[0] === 'W');
    expect(whiteOnly.length).toBeGreaterThan(0);

    const error = (() => {
      try {
        runDeckStage(whiteOnly);
        return null;
      } catch (thrown: unknown) {
        return thrown as SliceStageError;
      }
    })();

    expect(error?.stage).toBe('deckbuild');
    expect(error?.reason).toMatch(/not the 40 a legal Limited deck needs|short of playables|chose/);
  });

  it('fails, attributed, on an empty pool rather than building an empty deck', () => {
    expect(() => runDeckStage([])).toThrow(/stage "deckbuild" failed/);
  });
});
