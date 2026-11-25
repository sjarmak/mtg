// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement as h } from 'react';
import { curveLabel } from '../../src/routes/deck/columns';
import { MANA_CURVE_LABEL } from '../../src/routes/deck/CurveStrip';
import { GROUPING_LABEL } from '../../src/routes/deck/GroupingControl';
import { curveFrom } from '../../src/routes/deck/build';
import type { Variation, VariationEntry } from '../../src/routes/deck/workbench/client';
import {
  DECK_GROUPS_LABEL,
  DECK_PANE,
  SHARED_CRITERIA_LABEL,
  VariationDeck,
  entryGroupingFacts,
  variationCurve,
} from '../../src/routes/deck/workbench/VariationDeck';

interface ElementLike {
  readonly textContent: string | null;
  readonly getAttribute: (name: string) => string | null;
  readonly querySelector: (selector: string) => ElementLike | null;
  readonly querySelectorAll: (selector: string) => Iterable<ElementLike>;
  readonly compareDocumentPosition: (other: unknown) => number;
}

function asElement(value: unknown): ElementLike {
  return value as ElementLike;
}

afterEach(() => {
  cleanup();
  const host = globalThis as { readonly localStorage?: { clear?: () => void } };
  host.localStorage?.clear?.();
});

function entry(
  over: Partial<VariationEntry> & { readonly id: string; readonly name: string },
): VariationEntry {
  return {
    count: 1,
    manaCost: '{W}',
    manaValue: 1,
    typeLine: 'Creature — Skyborn Scout',
    criteria: ['sets'],
    reason: `why ${over.name} is here`,
    ...over,
  };
}

const SPELLS: VariationEntry[] = [
  entry({ id: 'xmp-skyborn-fledgling', name: 'Skyborn Fledgling', count: 4 }),
  entry({ id: 'xmp-ashen-vigil-keeper', name: 'Ashen Vigil-Keeper', count: 4 }),
  entry({
    id: 'xmp-alaric',
    name: 'Alaric, Hero of Hours',
    count: 3,
    manaCost: '{2}{W}{W}',
    manaValue: 4,
    typeLine: 'Legendary Planeswalker — Alaric',
    criteria: ['sets', 'archetype'],
  }),
  entry({
    id: 'xmp-river-ward',
    name: 'River Ward',
    count: 2,
    manaCost: '{W/U}',
    manaValue: 1,
    typeLine: 'Instant',
  }),
];

const LANDS: VariationEntry[] = [
  entry({
    id: 'xmp-sunpetal-grove',
    name: 'Sunpetal Grove',
    count: 4,
    manaCost: null,
    manaValue: 0,
    typeLine: 'Land',
    criteria: [],
  }),
];

const VARIATION: Variation = {
  version: 1,
  id: 'v1',
  name: 'white weenie',
  builtAt: '2026-10-03T20:00:00.000Z',
  parentId: null,
  criteria: { prompt: 'a fast white deck', sets: ['XMP'], colors: ['W'], size: 60, maxCopies: 4, themes: [] },
  statedCriteria: [{ id: 'sets', kind: 'structural', statement: 'printed in XMP' }],
  plan: 'curve out and attack',
  spells: SPELLS,
  lands: LANDS,
  basics: [{ color: 'W', count: 21, id: 'xmp-plains' }],
  manaBase: {
    totalLands: 25,
    nonBasicLands: 4,
    castabilityTarget: 0.9,
    heavyCastabilityTarget: 0.8,
    colors: [
      { color: 'W', pipCount: 39, sources: 25, sourceFloor: 16, castability: 0.96, meetsTarget: true },
    ],
    landReason: 'a mono-white aggro deck needs its first three land drops',
    landSource: 'model',
  },
  universeSize: 95,
  shortfalls: [],
};

function statementsOf(variation: Variation): ReadonlyMap<string, string> {
  return new Map(variation.statedCriteria.map((criterion) => [criterion.id, criterion.statement]));
}

function open(): ElementLike {
  const { container } = render(
    h(VariationDeck, { variation: VARIATION, statements: statementsOf(VARIATION) }),
  );
  return asElement(container);
}

function heads(groups: unknown): readonly (string | null)[] {
  return within(groups as HTMLElement)
    .getAllByRole('group')
    .map((node) => asElement(node).getAttribute('aria-label'));
}

describe('an entry read as grouping facts', () => {
  it('carries the name, mana value and type line through, and records no rarity', () => {
    const facts = entryGroupingFacts(SPELLS[2] as VariationEntry);
    expect(facts).toStrictEqual({
      name: 'Alaric, Hero of Hours',
      manaValue: 4,
      colorIdentity: 'W',
      typeLine: 'Legendary Planeswalker — Alaric',
      rarity: null,
    });
  });

  it('reads the colors off the cost pips, hybrid pips included', () => {
    expect(entryGroupingFacts(entry({ id: 'a', name: 'a', manaCost: '{W/U}{G}' })).colorIdentity).toBe('WUG');
    expect(entryGroupingFacts(entry({ id: 'b', name: 'b', manaCost: '{3}' })).colorIdentity).toBe('');
    expect(entryGroupingFacts(entry({ id: 'c', name: 'c', manaCost: null })).colorIdentity).toBe('');
  });
});

describe('the curve of a variation', () => {
  it('is contiguous and counts copies, lands at zero included', () => {
    expect(variationCurve(VARIATION)).toStrictEqual([
      { manaValue: 0, cards: 4 },
      { manaValue: 1, cards: 10 },
      { manaValue: 2, cards: 0 },
      { manaValue: 3, cards: 0 },
      { manaValue: 4, cards: 3 },
    ]);
  });

  it('is empty for a variation with no entries', () => {
    expect(variationCurve({ ...VARIATION, spells: [], lands: [] })).toStrictEqual([]);
  });

  it('is the one aggregator the builder reads', () => {
    expect(
      curveFrom([
        { manaValue: 2, cards: 1 },
        { manaValue: 2, cards: 1 },
        { manaValue: 4, cards: 1 },
      ]),
    ).toStrictEqual([
      { manaValue: 2, cards: 2 },
      { manaValue: 3, cards: 0 },
      { manaValue: 4, cards: 1 },
    ]);
  });
});

describe('the deck on the workbench', () => {
  it('draws the curve above the groups', () => {
    const container = open();
    const curve = screen.getByRole('list', { name: MANA_CURVE_LABEL });
    expect(within(curve).getByRole('listitem', { name: curveLabel(1, 10) })).toBeTruthy();
    const groups = screen.getByRole('group', { name: DECK_GROUPS_LABEL });
    const following = 4;
    expect(asElement(curve).compareDocumentPosition(groups) & following).toBe(following);
    expect(container.querySelector('.mtg-builder-curve')?.getAttribute('data-flow')).toBe('rows');
  });

  it('groups the boxes under mana-value heads with counts, by default', () => {
    open();
    const groups = screen.getByRole('group', { name: DECK_GROUPS_LABEL });
    expect(heads(groups)).toStrictEqual([curveLabel(0, 4), curveLabel(1, 10), curveLabel(4, 3)]);
    const ones = asElement(within(groups).getByRole('group', { name: curveLabel(1, 10) }));
    expect(
      [...ones.querySelectorAll('.mtg-workbench__entry-name')].map((node) => node.textContent),
    ).toStrictEqual(['Skyborn Fledgling', 'River Ward', 'Ashen Vigil-Keeper']);
  });

  it('keeps every reason and every citation on screen inside its group', () => {
    const container = open();
    const reasons = [...container.querySelectorAll('.mtg-deck__column .mtg-workbench__entry-reason')].map(
      (node) => node.textContent,
    );
    expect(reasons.sort()).toStrictEqual(
      [...SPELLS, ...LANDS].map((card) => `why ${card.name} is here`).sort(),
    );
    const cites = [...container.querySelectorAll('.mtg-deck__column .mtg-workbench__cite')].map((node) => [
      node.textContent,
      node.getAttribute('data-resolved'),
    ]);
    // `sets` is cited by every citing row, so it is said once above them and
    // the rows keep only what tells one card from another.
    expect(cites).toStrictEqual([['archetype', 'false']]);
  });

  it('states the criteria every card shares once, as the statement rather than the id', () => {
    const container = open();
    const shared = screen.getByRole('list', { name: SHARED_CRITERIA_LABEL });
    const items = [...asElement(shared).querySelectorAll('.mtg-workbench__cite')].map((node) => [
      node.getAttribute('data-criterion'),
      node.textContent,
      node.getAttribute('data-resolved'),
    ]);
    expect(items).toStrictEqual([['sets', 'printed in XMP', 'true']]);
    const following = 4;
    const groups = screen.getByRole('group', { name: DECK_GROUPS_LABEL });
    expect(asElement(shared).compareDocumentPosition(groups) & following).toBe(following);
    expect([...container.querySelectorAll('.mtg-workbench__shared')]).toHaveLength(1);
  });

  it('keeps a shared citation nobody stated marked as unresolved', () => {
    const everyCiting = (list: readonly VariationEntry[]): VariationEntry[] =>
      list.map((one) => (one.criteria.length === 0 ? one : { ...one, criteria: ['sets', 'archetype'] }));
    const variation = { ...VARIATION, spells: everyCiting(SPELLS), lands: everyCiting(LANDS) };
    const { container } = render(h(VariationDeck, { variation, statements: statementsOf(variation) }));
    const shared = screen.getByRole('list', { name: SHARED_CRITERIA_LABEL });
    const items = [...asElement(shared).querySelectorAll('.mtg-workbench__cite')].map((node) => [
      node.textContent,
      node.getAttribute('data-resolved'),
      node.getAttribute('title'),
    ]);
    expect(items).toStrictEqual([
      ['printed in XMP', 'true', 'sets'],
      ['archetype', 'false', 'no criterion archetype was stated'],
    ]);
    expect([...asElement(container).querySelectorAll('.mtg-deck__column .mtg-workbench__cite')]).toHaveLength(
      0,
    );
  });

  it('says nothing shared when one row is the only one citing', () => {
    const lone = { ...VARIATION, spells: SPELLS.slice(0, 1), lands: LANDS };
    const { container } = render(h(VariationDeck, { variation: lone, statements: statementsOf(lone) }));
    expect(screen.queryByRole('list', { name: SHARED_CRITERIA_LABEL })).toBeNull();
    expect(
      [...asElement(container).querySelectorAll('.mtg-deck__column .mtg-workbench__cite')].map(
        (node) => node.textContent,
      ),
    ).toStrictEqual(['sets']);
  });

  it('offers mana value, color and type, and never rarity, which an entry does not carry', () => {
    open();
    const control = asElement(screen.getByRole('combobox', { name: `${DECK_PANE}, ${GROUPING_LABEL}` }));
    expect([...control.querySelectorAll('option')].map((node) => node.textContent)).toStrictEqual([
      'Mana value',
      'Color',
      'Card type',
    ]);
  });

  it('regroups by color when asked, reading a hybrid pip as two colors', () => {
    open();
    fireEvent.change(screen.getByRole('combobox', { name: `${DECK_PANE}, ${GROUPING_LABEL}` }), {
      target: { value: 'color' },
    });
    const groups = screen.getByRole('group', { name: DECK_GROUPS_LABEL });
    expect(heads(groups)).toStrictEqual(['White, 11 cards', 'Multicolor, 2 cards', 'Colorless, 4 cards']);
    const textOf = (name: string): string =>
      asElement(within(groups).getByRole('group', { name })).textContent ?? '';
    expect(textOf('Multicolor, 2 cards')).toContain('River Ward');
    expect(textOf('Colorless, 4 cards')).toContain('Sunpetal Grove');
  });

  it('counts cards, not boxes, over each head', () => {
    const container = open();
    const counts = [...container.querySelectorAll('.mtg-deck__column-count')].map((node) => node.textContent);
    expect(counts).toStrictEqual(['4', '10', '3']);
  });
});
