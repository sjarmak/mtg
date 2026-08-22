// @vitest-environment jsdom
/**
 * The mana-value columns, and the pane header that stays in reach above them.
 *
 * **Nothing in this file proves a pixel, and nothing in it could.** jsdom
 * performs no layout: every `getBoundingClientRect` here is zeros, so "does the
 * curve fit on one screen" and "is the stuck header clear of the app bar" are
 * unanswerable in vitest by construction. Both were measured in
 * chrome-headless-shell 151 through `../../tools/deck-density.ts`, whose docblock
 * carries the arrangement and whose output carries the numbers.
 *
 * What is answerable here is everything upstream of layout: that the grouping is
 * a pure function with the arithmetic the capture shows, that the counts above
 * the columns sum to the count the pane already states, that a pane collapsing to
 * one column drops the head rather than repeating that number, that full mode
 * builds no columns at all, and -- for the sticky header -- the two facts about
 * the sheet a browser reading one page cannot check for us: that the offset is
 * not zero, and that the app bar it is offset from is still the sticky element it
 * was measured against.
 *
 * Markup-level assertions go through `renderToStaticMarkup`, because the
 * workspace tsconfig has no `lib: dom` and `getAttribute` is not typed here.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readDeckArtifact } from '../../src/lab/deck-artifact';
import type { DeckArtifact, DeckArtifactEntry } from '../../src/lab/deck-artifact';
import { DeckRoute, MAIN_DECK_LABEL } from '../../src/routes/DeckRoute';
import { columnLabel, manaValueColumns } from '../../src/routes/deck/columns';
import { deckViewStoreKey } from '../../src/routes/deck/view-mode';
import { BASE_CSS } from '../../src/styles/base';
import { DECK_CSS } from '../../src/styles/deck';

afterEach(cleanup);

interface StoreLike {
  clear(): void;
  setItem(key: string, value: string): void;
}

function store(): StoreLike {
  const host = globalThis as { readonly localStorage?: unknown };
  if (typeof host.localStorage !== 'object' || host.localStorage === null) {
    throw new Error('no preference store');
  }
  return host.localStorage as StoreLike;
}

beforeEach(() => {
  store().clear();
});

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const FIXTURE = join(REPO_ROOT, 'packages', 'decklab', 'fixtures', 'decks', 'boros-aggro.deck.json');

function committedDeck(): DeckArtifact {
  const parsed = readDeckArtifact(JSON.parse(readFileSync(FIXTURE, 'utf8')), FIXTURE);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.deck;
}

const DECK = committedDeck();

/**
 * A card of a stated mana value and count, built off the fixture's own shape.
 *
 * The name is invented rather than borrowed. A test that needs a card name should
 * mint one (`AGENTS.md`, the public-boundary rule), and here it is also what lets
 * a case state its curve in the assertion instead of hunting the fixture for a
 * printing that happens to have the value the case is about.
 */
function entryAt(name: string, manaValue: number, count: number): DeckArtifactEntry {
  const [first] = DECK.spells;
  if (first === undefined) throw new Error('the fixture has no spells');
  return { ...first, name, manaValue, count, criteria: [] };
}

describe('grouping a pane into mana-value columns', () => {
  it('makes one column per value present, ascending, and counts cards rather than entries', () => {
    // The capture's own arithmetic: the numbers above the columns sum to the
    // number in the pane title, which only holds if they count copies. Three
    // entries, seven cards, two columns.
    const columns = manaValueColumns([
      entryAt('Tidewrack Herald', 2, 3),
      entryAt('Cinder Oath', 1, 3),
      entryAt('Hollow Vigil', 2, 1),
    ]);
    expect(columns.map((column) => column.manaValue)).toEqual([1, 2]);
    expect(columns.map((column) => column.cards)).toEqual([3, 4]);
    expect(columns.reduce((sum, column) => sum + column.cards, 0)).toBe(7);
    // Counting entries would have said 1 and 2, which sums to a number that
    // appears nowhere else on the page.
    expect(columns.map((column) => column.entries.length)).toEqual([1, 2]);
  });

  it('leaves no empty column where the curve has a gap', () => {
    const columns = manaValueColumns([entryAt('Cinder Oath', 1, 4), entryAt('Vaultbreaker', 5, 2)]);
    expect(columns.map((column) => column.manaValue)).toEqual([1, 5]);
  });

  it('keeps a column’s entries in the order the artifact listed them', () => {
    const columns = manaValueColumns([
      entryAt('Second Sight', 3, 1),
      entryAt('Ashen Rite', 3, 1),
      entryAt('Brackwater Toll', 3, 1),
    ]);
    expect(columns[0]?.entries.map((entry) => entry.name)).toEqual([
      'Second Sight',
      'Ashen Rite',
      'Brackwater Toll',
    ]);
  });

  it('needs no land rule, because a land is a mana value like any other', () => {
    // The capture's leftmost column is 24 lands with no cost on any strip, and it
    // is leftmost because a land's mana value is 0. Since `mtg-o5z1` the main
    // deck pane holds the lands beside the spells, so this is now the capture's
    // own arrangement rather than a pane of lands standing in for it: the zero
    // column is every land in the deck, first, and nothing here special-cased it.
    const lands = [...DECK.lands, ...DECK.basics];
    const columns = manaValueColumns([...DECK.spells, ...lands]);
    expect(lands.every((entry) => entry.manaValue === 0)).toBe(true);
    expect(columns[0]?.manaValue).toBe(0);
    expect(columns[0]?.cards).toBe(lands.reduce((sum, entry) => sum + entry.count, 0));
    expect(columns.length).toBeGreaterThan(1);
  });

  it('says a column in a sentence, because a pip’s accessible name is a pip', () => {
    expect(columnLabel({ manaValue: 3, cards: 1, entries: [] })).toBe('Mana value 3, 1 card');
    expect(columnLabel({ manaValue: 0, cards: 12, entries: [] })).toBe('Mana value 0, 12 cards');
  });
});

/** Switch one pane to compact through its own control, the way a reader would. */
function compactPane(label: string): void {
  fireEvent.click(
    within(screen.getByRole('group', { name: `${label}, View` })).getByRole('button', {
      name: 'Compact list',
    }),
  );
}

describe('a compact pane drawn as columns', () => {
  it('builds a column per mana value, each named for a screen reader', () => {
    render(h(DeckRoute, { state: { status: 'ready', deck: DECK } }));
    compactPane(MAIN_DECK_LABEL);
    const main = [...DECK.spells, ...DECK.lands, ...DECK.basics];
    const values = [...new Set(main.map((entry) => entry.manaValue))].sort((a, b) => a - b);
    for (const value of values) {
      const cards = main
        .filter((entry) => entry.manaValue === value)
        .reduce((sum, entry) => sum + entry.count, 0);
      expect(
        screen.getByRole('group', { name: columnLabel({ manaValue: value, cards, entries: [] }) }),
      ).toBeTruthy();
    }
  });

  it('prints counts above the columns that sum to the pane’s own stated count', () => {
    store().setItem(deckViewStoreKey('main-deck'), 'compact');
    const html = renderToStaticMarkup(h(DeckRoute, { state: { status: 'ready', deck: DECK } }));
    const printed = [...html.matchAll(/class="mtg-deck__column-count">(\d+)</g)].map((hit) => Number(hit[1]));
    const cards = [...DECK.spells, ...DECK.lands, ...DECK.basics].reduce(
      (sum, entry) => sum + entry.count,
      0,
    );
    expect(printed.length).toBeGreaterThan(1);
    expect(printed.reduce((sum, count) => sum + count, 0)).toBe(cards);
    // And the pane's own title says that same number, which is the whole reason
    // the column counts are cards: the two agree or one of them is decoration.
    expect(html).toContain(`>${MAIN_DECK_LABEL}: ${String(cards)}<`);
  });

  it('drops the head when a pane is one column, rather than saying its count twice', () => {
    // A deck whose land slot took the whole list is one mana value, which after
    // `mtg-o5z1` is the shape a one-column pane arrives in: the pane is the deck.
    const deck: DeckArtifact = { ...DECK, spells: [], lands: [] };
    store().setItem(deckViewStoreKey('main-deck'), 'compact');
    const html = renderToStaticMarkup(h(DeckRoute, { state: { status: 'ready', deck } }));
    expect(manaValueColumns(DECK.basics)).toHaveLength(1);
    // The pane is still a column; it just has no number over it.
    expect(html).toContain(
      columnLabel(manaValueColumns(DECK.basics)[0] ?? { manaValue: 0, cards: 0, entries: [] }),
    );
    expect(html).not.toContain('mtg-deck__column-count');
  });

  it('keeps the head on a column holding one card, because that one has neighbors', () => {
    const deck: DeckArtifact = {
      ...DECK,
      spells: [entryAt('Cinder Oath', 1, 4), entryAt('Vaultbreaker', 5, 1)],
      lands: [],
      basics: [],
    };
    store().setItem(deckViewStoreKey('main-deck'), 'compact');
    const html = renderToStaticMarkup(h(DeckRoute, { state: { status: 'ready', deck } }));
    const printed = [...html.matchAll(/class="mtg-deck__column-count">(\d+)</g)].map((hit) => Number(hit[1]));
    expect(printed).toEqual([4, 1]);
  });

  it('leaves full mode a flat run, because a column of full tiles cannot fit six abreast', () => {
    const html = renderToStaticMarkup(h(DeckRoute, { state: { status: 'ready', deck: DECK } }));
    expect(html).toContain('data-view="full"');
    expect(html).not.toContain('mtg-deck__column');
    expect(html).not.toContain('grid-template-columns');
  });

  it('switches only the pane whose control was pressed, columns and all', () => {
    const deck: DeckArtifact = { ...DECK, sideboard: [entryAt('Ashen Rite', 3, 2)] };
    render(h(DeckRoute, { state: { status: 'ready', deck } }));
    compactPane(MAIN_DECK_LABEL);
    const values = new Set([...DECK.spells, ...DECK.lands, ...DECK.basics].map((e) => e.manaValue));
    // The sideboard pane is still full, so its one card contributes no column.
    expect(screen.getAllByRole('group', { name: /^Mana value/ }).length).toBe(values.size);
  });
});

describe('the pane header that stays in reach', () => {
  // mtg-n4d3. Measured before and after in chrome-headless-shell 151: the Spells
  // header left the screen entirely at 1024x768 and 810x1080 in full mode
  // (content edge at -135px and -145px) and sat under the app bar at 1280x800,
  // and it lands at 56.0px against a 55.8px bar at all three afterward.
  it('sticks its header rather than letting the pane’s only View control scroll away', () => {
    expect(DECK_CSS).toContain('.mtg-deck__section-head {');
    const rule = DECK_CSS.slice(DECK_CSS.indexOf('.mtg-deck__section-head {'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('position: sticky');
  });

  it('offsets that header by the app bar rather than pinning it to zero', () => {
    // `top: 0` is the obvious fix and it is the bug wearing a hat: the app bar is
    // already sticky at zero with a higher stacking order, so a header pinned
    // there is hidden behind an opaque bar instead of merely scrolled past.
    const rule = DECK_CSS.slice(DECK_CSS.indexOf('.mtg-deck__section-head {'));
    const body = rule.slice(0, rule.indexOf('}'));
    expect(body).toMatch(/top:\s*calc\(/);
    expect(body).not.toMatch(/top:\s*0/);
    // The offset only works because the padding is inside the pinned border box.
    expect(body).toContain('padding-block:');
  });

  it('is offset from a bar that is still sticky, which is the premise it was measured on', () => {
    // If `base.ts` ever stops pinning the bar, the offset becomes a gap rather
    // than a fit, and nothing else in the suite would say so.
    const bar = BASE_CSS.slice(BASE_CSS.indexOf('.mtg-shell__bar {'));
    expect(bar.slice(0, bar.indexOf('}'))).toContain('position: sticky');
  });

  it('paints its own ground, so cards scroll under it instead of through its text', () => {
    const rule = DECK_CSS.slice(DECK_CSS.indexOf('.mtg-deck__section-head {'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('background:');
  });
});
