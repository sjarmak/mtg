// @vitest-environment jsdom
/**
 * What the shared draft surface says about a card's rating, in the three states
 * it can be in. ADR-0005: a rating is never a bare number, so every state names
 * its source or says outright that there is none.
 *
 * The third state is the one this file exists for. A format that stages a
 * ranking which happens to miss a card used to print "No ranking for this set.",
 * because the route caught the lookup's error and answered it with the sentence
 * meant for a set that stages nothing. That reports a one-card gap as a property
 * of the whole set, and it hides a real fault behind a plausible sentence.
 *
 * Driven through `DraftPackSurface` rather than a route, because the sentence is
 * the surface's and both draft routes read it from here.
 */
import { createElement as h } from 'react';
import type { ReactElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DraftPackSurface } from '../../src/routes/draft/DraftPack';
import type { DraftCardPresentation, DraftCardRating } from '../../src/routes/draft/DraftPack';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const PACK = ['Alpha', 'Beta'] as const;

/** Just enough card for the rail to draw one: a name, and a face you can click. */
function presentation(ratingOf?: (card: string) => DraftCardRating | null): DraftCardPresentation<string> {
  return {
    keyOf: (card) => card,
    nameOf: (card) => card,
    groupingFactsOf: (card) => ({
      name: card,
      manaValue: 1,
      colorIdentity: 'W',
      typeLine: 'Creature',
      rarity: null,
    }),
    stripFactsOf: (card, key) => ({ key, name: card, manaCost: '{W}', colorIdentity: 'W', copies: 1 }),
    orderPack: (cards) => cards.map((card, index) => ({ card, index })),
    renderFace: (card, options): ReactElement =>
      h('button', { key: options.key ?? card, onClick: options.onSelect, type: 'button' }, card),
    ...(ratingOf === undefined ? {} : { ratingOf }),
  };
}

function readFirstCard(ratingOf?: (card: string) => DraftCardRating | null): void {
  render(
    h(DraftPackSurface<string>, {
      draft: { picks: { length: 0 } },
      next: { round: 1, pickNumber: 1, packSize: PACK.length, cards: PACK },
      pool: [],
      onPick: (): void => undefined,
      onNewDraft: (): void => undefined,
      presentation: presentation(ratingOf),
    }),
  );
  const pack = screen.getByRole('group', { name: /^Draft pack / });
  fireEvent.click(within(pack).getAllByRole('button')[0]!);
}

it('draws no rating line at all for a presentation with no rating source', () => {
  readFirstCard();
  expect(screen.queryByText(/ranking/i)).toBeNull();
  expect(screen.queryByText(/\/5$/)).toBeNull();
});

it('names the source beside the number', () => {
  readFirstCard(() => ({ value: 3.5, source: 'Forge Limited ranking' }));
  expect(screen.getByText('Forge Limited ranking: 3.5/5')).toBeTruthy();
});

it('says the set has no ranking when the presentation has no source for it', () => {
  readFirstCard(() => null);
  expect(screen.getByText('No ranking for this set.')).toBeTruthy();
});

it('blames the card, not the set, when the source covers the set but misses the card', () => {
  readFirstCard(() => ({ value: null, source: 'Forge Limited ranking' }));
  expect(screen.getByText('Forge Limited ranking: not ranked for this card.')).toBeTruthy();
  expect(screen.queryByText('No ranking for this set.')).toBeNull();
});

it('draws no switch for a presentation with no rating source', () => {
  readFirstCard();
  expect(screen.queryByRole('button', { name: /ratings$/i })).toBeNull();
});

it('hides the rating line, and stops calling ratingOf, once the switch is pressed', () => {
  const ratingOf = vi.fn((): DraftCardRating => ({ value: 3.5, source: 'Forge Limited ranking' }));
  readFirstCard(ratingOf);
  expect(screen.getByText('Forge Limited ranking: 3.5/5')).toBeTruthy();
  expect(ratingOf).toHaveBeenCalled();
  ratingOf.mockClear();

  fireEvent.click(screen.getByRole('button', { name: 'Hide ratings' }));
  expect(screen.queryByText(/\/5$/)).toBeNull();
  expect(ratingOf).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Show ratings' }));
  expect(screen.getByText('Forge Limited ranking: 3.5/5')).toBeTruthy();
});
