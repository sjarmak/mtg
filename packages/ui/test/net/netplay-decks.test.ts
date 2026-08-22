import { describe, expect, it } from 'vitest';
import { parsePreconFile } from '@mtg/deckbuild';
import { selectPreconPair } from '../../tools/netplay-decks';

const FILE = parsePreconFile({
  formatVersion: 1,
  setCode: 'NET',
  decks: ['alpha', 'beta', 'gamma'].map((id) => ({
    id,
    name: id.toUpperCase(),
    plan: `Play ${id}.`,
    payoff: `${id}-card`,
    deckSize: 1,
    basics: {},
    spells: [{ id: `${id}-card`, count: 1 }],
  })),
});

describe('the precons a network table seats', () => {
  it('uses the first two written decks by default', () => {
    expect(selectPreconPair(FILE, undefined).map((deck) => deck.id)).toEqual(['alpha', 'beta']);
  });

  it('uses the two ids named by the launcher', () => {
    expect(selectPreconPair(FILE, 'gamma,alpha').map((deck) => deck.id)).toEqual(['gamma', 'alpha']);
  });

  it('names every available id when a requested deck is absent', () => {
    expect(() => selectPreconPair(FILE, 'alpha,missing')).toThrow(/alpha, beta, gamma/);
  });

  it('requires exactly two ids', () => {
    expect(() => selectPreconPair(FILE, 'alpha')).toThrow(/two deck ids/);
  });
});
