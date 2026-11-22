// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { PrintedCardCatalog, PrintedCardCatalogEntry } from '@mtg/printed-card';
import { CubeCardsRoute, matchesCubeCard } from '../../src/routes/legacy-cube/CubeCardsRoute';
import { readLegacyCubeCatalog } from '../../src/routes/legacy-cube/model';

let catalog: PrintedCardCatalog;
beforeAll(async () => {
  catalog = await readLegacyCubeCatalog(
    JSON.parse(readFileSync('packages/data/data/legacy-cube-2021-card-catalog-v1.json', 'utf8')) as unknown,
  );
});
afterEach(cleanup);

function card(name: string): PrintedCardCatalogEntry {
  const found = catalog.cards.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`Missing fixture ${name}`);
  return found;
}

it('filters real Oracle facts including artifacts, lands, multicolor and mana value', () => {
  expect(
    matchesCubeCard(card('Reanimate'), {
      q: 'target creature graveyard',
      color: 'Black',
      type: 'Sorcery',
      mv: '1',
    }),
  ).toBe(true);
  expect(matchesCubeCard(card('Reanimate'), { color: 'Blue' })).toBe(false);
  expect(matchesCubeCard(card('Reanimate'), { type: 'Creature' })).toBe(false);
  expect(matchesCubeCard(card('Reanimate'), { mv: '2' })).toBe(false);
  expect(matchesCubeCard(card('Reanimate'), { color: 'Colorless' })).toBe(false);
  expect(matchesCubeCard(card('Reanimate'), { color: 'Multicolor' })).toBe(false);
  for (const entry of catalog.cards) {
    expect(matchesCubeCard(entry, { mv: '7+' })).toBe(entry.manaValue >= 7);
    expect(matchesCubeCard(entry, { color: 'Multicolor' })).toBe(entry.colors.length > 1);
    expect(matchesCubeCard(entry, { color: 'Colorless' })).toBe(entry.colors.length === 0);
    expect(matchesCubeCard(entry, { q: entry.name })).toBe(true);
  }
  expect(matchesCubeCard(card('Reanimate'), { type: 'stale', color: 'stale', mv: 'stale' })).toBe(true);
});

it('shows both faces with exact text and keeps the catalog immutable', () => {
  const entry = catalog.cards.find((candidate) => candidate.faces.length > 1)!;
  const before = JSON.stringify(entry);
  const onSetParams = vi.fn();
  render(
    h(CubeCardsRoute, {
      catalog: { status: 'ready', catalog: { ...catalog, cards: [entry] } },
      route: { mode: 'cards', sub: 'gallery', params: {} },
      onSetParams,
    }),
  );
  expect(screen.getAllByText(entry.faces[0]!.name).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: `Show ${entry.faces[1]!.name} face of ${entry.name}` }));
  expect(screen.getAllByText(entry.faces[1]!.name).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: `Show ${entry.faces[0]!.name} face of ${entry.name}` }));
  expect(screen.getAllByText(entry.faces[0]!.name).length).toBeGreaterThan(0);
  expect(JSON.stringify(entry)).toBe(before);
});

it('exposes accessible filtering, selection and clearing without inventing rarity metadata', () => {
  const entry = card('Reanimate');
  const onSetParams = vi.fn();
  const view = render(
    h(CubeCardsRoute, {
      catalog: { status: 'ready', catalog: { ...catalog, cards: [entry] } },
      route: { mode: 'cards', sub: 'gallery', params: { size: 'compact' } },
      onSetParams,
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  expect(
    (
      screen.getByRole('button', { name: 'Filters' }) as unknown as { getAttribute(name: string): string }
    ).getAttribute('aria-expanded'),
  ).toBe('true');
  for (const [label, value, key] of [
    ['Color', 'Black', 'color'],
    ['Type', 'Sorcery', 'type'],
    ['Mana value', '1', 'mv'],
    ['Size', 'full', 'size'],
  ] as const) {
    fireEvent.change(screen.getByRole('combobox', { name: label }), { target: { value } });
    expect(onSetParams).toHaveBeenLastCalledWith({ [key]: value });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Reanimate' }));
  expect(onSetParams).toHaveBeenLastCalledWith({ card: entry.physicalId });
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(onSetParams).toHaveBeenLastCalledWith({ q: '', color: '', type: '', mv: '', card: '', rarity: '' });
  expect(screen.queryByRole('combobox', { name: 'Rarity' })).toBeNull();
  view.rerender(
    h(CubeCardsRoute, {
      catalog: { status: 'ready', catalog },
      route: { mode: 'cards', sub: 'gallery', params: { q: 'no such card exists' } },
      onSetParams,
    }),
  );
  expect(screen.getByText('No cards match these filters.')).toBeDefined();
});

it('reports loading, missing and invalid artifacts separately', () => {
  const props = {
    route: { mode: 'cards' as const, sub: 'gallery' as const, params: {} },
    onSetParams: vi.fn(),
  };
  const view = render(h(CubeCardsRoute, { ...props, catalog: { status: 'loading' } }));
  expect(screen.getByText('Reading Legacy Cube cards…')).toBeDefined();
  view.rerender(
    h(CubeCardsRoute, { ...props, catalog: { status: 'failed', message: 'Catalog checksum mismatch' } }),
  );
  expect(screen.getByText('Catalog checksum mismatch')).toBeDefined();
  view.rerender(h(CubeCardsRoute, { ...props, catalog: { status: 'absent' } }));
  expect(screen.getByText('Legacy Cube is not staged.')).toBeDefined();
});

it('draws compact as name strips with no card face, and selects from a strip', () => {
  const entry = card('Reanimate');
  const onSetParams = vi.fn();
  const view = render(
    h(CubeCardsRoute, {
      catalog: { status: 'ready', catalog: { ...catalog, cards: [entry] } },
      route: { mode: 'cards', sub: 'gallery', params: { size: 'compact' } },
      onSetParams,
    }),
  );
  const root = view.container as unknown as { querySelectorAll(selector: string): ArrayLike<Element> };
  expect(root.querySelectorAll('.mtg-strips__card')).toHaveLength(1);
  expect(root.querySelectorAll('.mtg-card')).toHaveLength(0);
  fireEvent.click(root.querySelectorAll('.mtg-strips__card')[0]!);
  expect(onSetParams).toHaveBeenLastCalledWith({ card: entry.physicalId });
});
