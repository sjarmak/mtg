/**
 * The seat picker's judgments: a typed answer becoming a deck, a blank seed
 * meaning a fresh game, and the flag line the picker hands to `netplay`.
 *
 * The questions themselves, the terminal and the subprocess are not tested here
 * and are not meant to be; `table.ts` holds those and nothing else, which is the
 * reason these four functions live in their own file.
 */
import { describe, expect, it } from 'vitest';
import type { PreconDeck } from '@mtg/deckbuild';
import { chooseDeck, chooseName, chooseSeed, deckMenu, netplayFlags } from '../tools/table/menu';

function deck(id: string, name: string, plan: string): PreconDeck {
  return {
    id,
    name,
    plan,
    payoff: `${id}-payoff`,
    spells: [{ id: `${id}-payoff`, count: 1 }],
    basics: { R: 17 },
    deckSize: 18,
  };
}

const DECKS: readonly PreconDeck[] = [
  deck('deck-one', 'Deck One', 'attacks early and often'),
  deck('deck-two', 'Deck Two', 'holds the ground and wins late'),
];

describe('deckMenu', () => {
  it('prints each deck with the sentence it states about itself', () => {
    const lines = deckMenu(DECKS);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('1. Deck One');
    expect(lines[0]).toContain('attacks early and often');
    expect(lines[1]).toContain('2. Deck Two');
  });
});

describe('chooseDeck', () => {
  it('takes a number, which is what the menu just printed', () => {
    expect(chooseDeck(DECKS, '2', DECKS[0]!).id).toBe('deck-two');
  });

  it('takes a deck id, because that is the name every other launcher uses', () => {
    expect(chooseDeck(DECKS, 'deck-two', DECKS[0]!).id).toBe('deck-two');
  });

  it('takes the offered deck when the answer is blank', () => {
    expect(chooseDeck(DECKS, '   ', DECKS[1]!).id).toBe('deck-two');
  });

  it('says how far the menu goes when the number is past its end', () => {
    expect(() => chooseDeck(DECKS, '7', DECKS[0]!)).toThrow(/up to 2/);
  });

  it('refuses a name that is not a deck here rather than seating something else', () => {
    expect(() => chooseDeck(DECKS, 'deck-nine', DECKS[0]!)).toThrow(/deck-nine/);
  });
});

describe('chooseSeed', () => {
  it('reads a typed word as the seed', () => {
    expect(chooseSeed(' vantia-night ')).toBe('vantia-night');
  });

  it('leaves a blank answer undefined, so netplay stays the one place a fresh seed is invented', () => {
    expect(chooseSeed('')).toBeUndefined();
  });
});

describe('chooseName', () => {
  it('falls back to the label the prompt offered', () => {
    expect(chooseName('  ', 'Seat one')).toBe('Seat one');
  });
});

describe('netplayFlags', () => {
  it('names both decks and both seats, and omits the seed when the game is a fresh one', () => {
    const flags = netplayFlags({
      setPath: undefined,
      decks: [DECKS[0]!, DECKS[1]!],
      names: ['Ana', 'Bo'],
      seed: undefined,
    });
    expect(flags).toEqual(['--decks', 'deck-one,deck-two', '--names', 'Ana,Bo']);
  });

  it('leads with the set path when one was named, the way netplay reads it', () => {
    const flags = netplayFlags({
      setPath: 'out/play/a.set.json',
      decks: [DECKS[0]!, DECKS[0]!],
      names: ['Ana', 'Bo'],
      seed: 'same-again',
    });
    expect(flags[0]).toBe('out/play/a.set.json');
    expect(flags.slice(-2)).toEqual(['--seed', 'same-again']);
  });
});
