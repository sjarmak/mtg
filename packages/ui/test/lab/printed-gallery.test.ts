// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import { PrintedCardsGallery } from '../../src/routes/printed/PrintedCardsGallery';

const catalogs = ['akh', 'hou'].map((code) =>
  parsePrintedCardCatalog(
    JSON.parse(readFileSync(`packages/data/data/akh-hou/${code}-printed-catalog-v1.json`, 'utf8')),
  ),
);
afterEach(cleanup);

function identityOf(element: HTMLElement): string | null {
  return (element as unknown as { readonly getAttribute: (name: string) => string | null }).getAttribute(
    'data-identity',
  );
}

it('does not retain an invisible rarity filter for catalogs without display metadata', () => {
  render(
    h(PrintedCardsGallery, {
      cards: catalogs[0]!.cards.slice(0, 1),
      title: 'Catalog',
      description: '',
      route: { mode: 'cards', sub: 'gallery', params: { rarity: 'mythic', sort: 'Rarity' } },
      onSetParams: vi.fn(),
    }),
  );
  expect(screen.getByText('1 of 1 shown')).toBeDefined();
  expect(screen.queryByRole('combobox', { name: 'Rarity' })).toBeNull();
});

it('filters and sorts exact printings by rarity without changing catalog order', () => {
  const cards = catalogs[0]!.cards.slice(0, 3);
  const rarities = Object.fromEntries(
    cards.map((card, index) => [card.physicalId, (['rare', 'common', 'mythic'] as const)[index]!]),
  );
  const onSetParams = vi.fn();
  const props = {
    cards,
    rarities,
    title: 'Amonkhet',
    description: '',
    onSetParams,
    route: { mode: 'cards' as const, sub: 'gallery' as const, params: { sort: 'Rarity' } },
  };
  const view = render(h(PrintedCardsGallery, props));
  expect(screen.queryByRole('option', { name: 'bonus' })).toBeNull();
  expect(screen.queryByRole('option', { name: 'special' })).toBeNull();
  const ids = () =>
    screen
      .getAllByRole('button')
      .map((card) =>
        (card as unknown as { getAttribute(name: string): string | null }).getAttribute('data-physical-id'),
      )
      .filter(Boolean);
  expect(ids()).toEqual([cards[1]!.physicalId, cards[0]!.physicalId, cards[2]!.physicalId]);
  expect(
    (
      screen.getByRole('button', { name: new RegExp(`^${cards[0]!.name}\\.`) }) as unknown as {
        getAttribute(name: string): string | null;
      }
    ).getAttribute('data-rarity'),
  ).toBe('rare');
  expect(
    (
      screen.getByRole('button', { name: new RegExp(`^${cards[2]!.name}\\.`) }) as unknown as {
        getAttribute(name: string): string | null;
      }
    ).getAttribute('data-rarity'),
  ).toBe('mythic');
  fireEvent.change(screen.getByRole('combobox', { name: 'Rarity' }), { target: { value: 'mythic' } });
  expect(onSetParams).toHaveBeenCalledWith({ rarity: 'mythic' });
  view.rerender(
    h(PrintedCardsGallery, {
      ...props,
      route: { mode: 'cards', sub: 'gallery', params: { rarity: 'mythic' } },
    }),
  );
  expect(ids()).toEqual([cards[2]!.physicalId]);
  expect(cards).toEqual(catalogs[0]!.cards.slice(0, 3));
});

it('shares printed filters and split-face controls across individual and combined catalogs', () => {
  const cards = catalogs.flatMap((catalog) => catalog.cards);
  const onSetParams = vi.fn();
  const props = {
    cards,
    title: 'Amonkhet / Hour of Devastation',
    description: 'Printed source cards',
    route: { mode: 'cards' as const, sub: 'gallery' as const, params: { q: 'Appeal' } },
    onSetParams,
  };
  const view = render(h(PrintedCardsGallery, props));
  expect(screen.getByRole('heading', { name: props.title })).toBeDefined();
  expect(screen.getByText('1 of 496 shown')).toBeDefined();
  expect(identityOf(screen.getByRole('button', { name: /^Appeal\./ }))).toBe('g');
  fireEvent.click(screen.getByRole('button', { name: 'Show Authority face of Appeal // Authority' }));
  expect(identityOf(screen.getByRole('button', { name: /^Authority\./ }))).toBe('w');
  view.rerender(
    h(PrintedCardsGallery, {
      ...props,
      route: { mode: 'cards', sub: 'gallery', params: { q: 'Driven' } },
    }),
  );
  expect(identityOf(screen.getByRole('button', { name: /^Driven\./ }))).toBe('g');
  fireEvent.click(screen.getByRole('button', { name: 'Show Despair face of Driven // Despair' }));
  expect(identityOf(screen.getByRole('button', { name: /^Despair\./ }))).toBe('b');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'eternalize' } });
  expect(onSetParams).toHaveBeenCalledWith({ q: 'eternalize' });
  view.rerender(
    h(PrintedCardsGallery, {
      ...props,
      cards: catalogs[1]!.cards,
      title: 'Hour of Devastation',
      route: { mode: 'cards', sub: 'gallery', params: {} },
    }),
  );
  expect(screen.getByText('209 of 209 shown')).toBeDefined();
});
