// @vitest-environment jsdom
import { createElement as h } from 'react';
import type { ReactElement } from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DraftPackSurface } from '../../src/routes/draft/DraftPack';
import type { DraftCardPresentation, DraftCardRating } from '../../src/routes/draft/DraftPack';

interface ElementLike {
  readonly textContent: string | null;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const PACK = ['Alpha', 'Beta'] as const;

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

function mount(ratingOf?: (card: string) => DraftCardRating | null): void {
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
}

it('states no order at all for a presentation with no rating source', () => {
  mount();
  expect(screen.queryByText(/first$/)).toBeNull();
});

it('states the source and best-rated-first while the switch is on', () => {
  mount(() => ({ value: 3.5, source: 'Forge Limited ranking' }));
  expect(screen.getByText('Forge Limited ranking: best rated first')).toBeTruthy();
});

it('states rarest-first, with no source named, once the switch is off', () => {
  mount(() => ({ value: 3.5, source: 'Forge Limited ranking' }));
  fireEvent.click(screen.getByRole('button', { name: 'Hide ratings' }));
  expect(screen.getByText('Rarest first')).toBeTruthy();
  expect(screen.queryByText(/Forge Limited ranking/)).toBeNull();
});

it('states both how to read a card and how to take it', () => {
  mount();
  const empty = screen.getByText(/Point at a card in the pack/) as unknown as ElementLike;
  expect(empty.textContent ?? '').toContain('Press Pick to take the card you are reading.');
});
