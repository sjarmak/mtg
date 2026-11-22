import { describe, expect, it } from 'vitest';
import { checkStandardDeck } from '../src/standard-deck';
import type { PrintedCardCatalogEntry } from '../src/index';

const entry = (name: string, typeLine: string, oracleText: string | null = null) =>
  ({
    physicalId: `ktk-printed-v1:${name.toLowerCase()}`,
    correctedName: name,
    typeLine,
    oracleText,
  }) as PrintedCardCatalogEntry;
const bear = entry('Runeclaw Bear', 'Creature — Bear');
const plains = entry('Plains', 'Basic Land — Plains');
const petitioners = entry(
  'Persistent Petitioners',
  'Creature — Human Advisor',
  'A deck can have any number of cards named Persistent Petitioners.',
);
const printings = new Map([bear, plains, petitioners].map((card) => [card.physicalId, card] as const));
const slot = (card: PrintedCardCatalogEntry, count: number) => ({
  physicalId: card.physicalId,
  name: card.correctedName,
  count,
});

describe('Standard deck check', () => {
  it('accepts sixty cards with four copies except basics and named exceptions', () => {
    expect(
      checkStandardDeck(
        {
          id: 'legal',
          name: 'Legal',
          commanders: [],
          cards: [slot(bear, 4), slot(plains, 36), slot(petitioners, 20)],
        },
        printings,
      ),
    ).toEqual({ legal: true, cards: 60, findings: [] });
  });

  it('accepts decks larger than the sixty-card minimum', () => {
    expect(
      checkStandardDeck(
        {
          id: 'large',
          name: 'Large',
          commanders: [],
          cards: [slot(bear, 4), slot(plains, 37), slot(petitioners, 20)],
        },
        printings,
      ),
    ).toEqual({ legal: true, cards: 61, findings: [] });
  });

  it('names size, copy-limit and unresolved-card failures', () => {
    const verdict = checkStandardDeck(
      {
        id: 'illegal',
        name: 'Illegal',
        commanders: [],
        cards: [slot(bear, 5), slot(plains, 54), { physicalId: 'missing', name: 'Ghost', count: 1 }],
      },
      printings,
    );
    expect(verdict).toEqual({
      legal: false,
      cards: 60,
      findings: [
        { kind: 'duplicate', detail: 'Runeclaw Bear appears 5 times' },
        { kind: 'unresolved', detail: 'Ghost is not a printing this catalog carries' },
      ],
    });
    expect(
      checkStandardDeck({ id: 'short', name: 'Short', commanders: [], cards: [slot(plains, 59)] }, printings)
        .findings,
    ).toEqual([{ kind: 'deck-size', detail: '59 cards; a constructed deck has at least 60' }]);
  });
});
