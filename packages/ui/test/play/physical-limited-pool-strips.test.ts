// @vitest-environment jsdom
/**
 * The generic physical-card pool (`../../src/routes/play/SealedBuilder.ts`'s
 * `physicalCards`), which `../../src/routes/printed/PrintedPoolEditor.ts` reaches
 * through `PhysicalLimitedBuilder` for both the printed draft and sealed
 * screens. `mtg-eeqnj`: this pane drew small card-shaped tiles at compact,
 * unlike the deck pane beside it; it now draws the same name strips.
 *
 * The gestures asserted here are the pane's own, unchanged by the switch: a
 * click toggles a card into the deck, the pane has no double-click move of its
 * own (the strip's `onActivate` is a no-op that only absorbs the second click
 * of a double click), and a right click opens the inspect panel.
 */
import { createElement as h, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { addPhysicalCard, cutPhysicalCard, validateLimitedDeck } from '@mtg/limited';
import type { LimitedDeck } from '@mtg/limited';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import type { PrintedCardCatalogEntry } from '@mtg/printed-card';
import catalogJson from '../../../data/data/legacy-cube-2021-card-catalog-v1.json';
import { PrintedCardFace } from '../../src/card/PrintedCardFace';
import { PhysicalLimitedBuilder } from '../../src/routes/play/SealedBuilder';
import type { LimitedCardPresentation } from '../../src/routes/play/SealedBuilder';

afterEach(cleanup);

const catalog = parsePrintedCardCatalog(catalogJson);

/** Enough of the pinned cube to fill the pool with a few columns. */
const CARDS = catalog.cards.slice(0, 20);

const PRESENTATION: LimitedCardPresentation<PrintedCardCatalogEntry> = {
  nameOf: (card) => card.name,
  groupingFactsOf: (card) => ({
    name: card.name,
    manaValue: card.manaValue,
    colorIdentity: card.colorIdentity.join(''),
    typeLine: card.typeLine,
    rarity: null,
  }),
  manaCostOf: (card) => card.manaCost,
  renderFace: (card, options) => h(PrintedCardFace, { ...options, card }),
};

function initialDeck(): LimitedDeck<PrintedCardCatalogEntry> {
  const prepared = CARDS.map((card) => ({
    physicalId: card.physicalId,
    payload: card,
    facts: {
      name: card.name,
      colors: card.colors,
      manaValue: card.manaValue,
      type: card.typeLine.includes('Creature') ? ('creature' as const) : ('noncreature-spell' as const),
      score: 1,
    },
  }));
  return {
    pool: prepared,
    selectedPhysicalIds: [],
    basics: { Plains: 0, Island: 0, Swamp: 0, Mountain: 0, Forest: 0 },
    minimumDeckSize: 24,
    suggestedBasicLands: 12,
  };
}

function Rig(): ReturnType<typeof PhysicalLimitedBuilder<PrintedCardCatalogEntry>> {
  const [deck, setDeck] = useState(initialDeck);
  return h(PhysicalLimitedBuilder<PrintedCardCatalogEntry>, {
    physicalDeck: deck,
    report: validateLimitedDeck(deck),
    presentation: PRESENTATION,
    onToggle: (physicalId) =>
      setDeck((current) =>
        current.selectedPhysicalIds.includes(physicalId)
          ? cutPhysicalCard(current, physicalId)
          : addPhysicalCard(current, physicalId),
      ),
    onSuggest: (): void => undefined,
    onClear: (): void => undefined,
    onAdjustBasic: (): void => undefined,
    onSuggestBasics: (): void => undefined,
    onPlay: (): void => undefined,
    seed: 'physical-pool-strips-test/v0',
    contextNote: '20 physical cards',
    poolLabel: 'Drafted pool',
    title: 'Test pool',
  });
}

interface ElementLike {
  readonly getAttribute: (name: string) => string | null;
  readonly querySelectorAll: (selector: string) => { readonly length: number };
}

function asElement(value: unknown): ElementLike {
  const candidate = value as Partial<ElementLike> | null | undefined;
  if (candidate === null || candidate === undefined || typeof candidate.getAttribute !== 'function') {
    throw new Error('expected a rendered element');
  }
  return candidate as ElementLike;
}

function switchToCompact(): void {
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Drafted pool, View' })).getByRole('button', {
      name: 'Compact list',
    }),
  );
}

describe('the physical pool at compact, drawn as strips', () => {
  it('draws one strip per card with no picture, the way the deck pane already does', () => {
    render(h(Rig));
    switchToCompact();
    const pool = asElement(screen.getByRole('group', { name: 'Drafted pool' }));
    expect(pool.getAttribute('data-density')).toBe('compact');
    expect(pool.querySelectorAll('.mtg-art').length).toBe(0);
    expect(pool.querySelectorAll('img').length).toBe(0);
    expect(within(screen.getByRole('group', { name: 'Drafted pool' })).getAllByRole('button')).toHaveLength(
      CARDS.length,
    );
  });

  it('toggles the card into the deck on a click, and does not toggle it again on the second click of a double click', () => {
    render(h(Rig));
    switchToCompact();
    const card = CARDS[0];
    if (card === undefined) throw new Error('expected a fixture card');
    const pool = screen.getByRole('group', { name: 'Drafted pool' });
    const strip = within(pool).getByRole('button', { name: card.name });

    fireEvent.click(strip, { detail: 1 });
    expect(
      within(screen.getByRole('group', { name: 'Cards in your deck' })).queryByText(card.name),
    ).toBeTruthy();

    // The rest of a real double click: guarded by the same rule
    // `../../src/routes/deck/StripColumns.ts` applies everywhere it has an
    // `onActivate`, and this pane's is a no-op, so neither event toggles the
    // card back out.
    fireEvent.click(strip, { detail: 2 });
    fireEvent.doubleClick(strip);
    expect(
      within(screen.getByRole('group', { name: 'Cards in your deck' })).queryByText(card.name),
    ).toBeTruthy();
  });

  it('opens the inspect panel on a right click, the pool pane’s existing move', () => {
    const view = render(h(Rig));
    switchToCompact();
    const card = CARDS[1];
    if (card === undefined) throw new Error('expected a fixture card');
    const pool = screen.getByRole('group', { name: 'Drafted pool' });
    const strip = within(pool).getByRole('button', { name: card.name });
    const container = asElement(view.container);

    expect(container.querySelectorAll('.mtg-cardpeek').length).toBe(0);
    fireEvent.contextMenu(strip);
    expect(container.querySelectorAll('.mtg-cardpeek').length).toBe(1);
  });
});
