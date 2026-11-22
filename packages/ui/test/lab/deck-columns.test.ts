// @vitest-environment jsdom
/**
 * The mana-value columns, and the pane header that sits above their box.
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
 * builds no columns at all, and -- for the pane header -- the two facts about
 * the sheet a browser reading one page cannot check for us: that the header is
 * positioned by nothing, and that the box under it is the one carrying the
 * scroll.
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
import { deckOpenParam } from '../../src/routes/deck/open';
import { groupHeadLabel, groupMembers } from '../../src/routes/deck/grouping';
import type { Group } from '../../src/routes/deck/grouping';
import { deckViewStoreKey } from '../../src/routes/deck/view-mode';
import { DECK_CSS } from '../../src/styles/deck';

/**
 * The link that opens the staged artifact deck.
 *
 * Since `mtg-nuk3` the Decks tab lands on the library and an open deck takes the
 * whole route, so a render that means to describe a deck has to say which one.
 * A link rather than a click because these read the markup of one render: the
 * param is exactly what a person following a link to this deck arrives with.
 */
const OPEN_ARTIFACT = deckOpenParam({ kind: 'artifact' });

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

/**
 * The artifact pane's columns, which are `groupMembers` on the mana-value axis.
 *
 * They were `../../src/routes/deck/columns.ts`'s own `manaValueColumns` until
 * `mtg-pmpu`. That function outlived its last caller when the full grid started
 * reading the pane's grouping like every other density, so what these cases are
 * about is the axis rather than a second implementation of it, and they say so
 * by calling the one every pane calls.
 */
function manaValueColumns(entries: readonly DeckArtifactEntry[]): readonly Group<DeckArtifactEntry>[] {
  return groupMembers(
    entries,
    (entry) => ({
      name: entry.name,
      manaValue: entry.manaValue,
      colorIdentity: entry.colorIdentity,
      typeLine: entry.typeLine,
      // A built artifact's entries carry none, which is the whole of
      // `offeredGroupings`' reason to exist.
      rarity: null,
    }),
    (entry) => entry.count,
    'manaValue',
  );
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
    expect(columns.map((column) => column.members.length)).toEqual([1, 2]);
  });

  it('leaves no empty column where the curve has a gap', () => {
    const columns = manaValueColumns([entryAt('Cinder Oath', 1, 4), entryAt('Vaultbreaker', 5, 2)]);
    expect(columns.map((column) => column.manaValue)).toEqual([1, 5]);
  });

  it('names a column’s entries in order, whatever order the artifact listed them', () => {
    // The artifact's own order until `mtg-pmpu`, and alphabetical since, because
    // this is now the grouping every pane reads and that is what it has always
    // done for the panes holding DSL cards. A producer's list order is an
    // implementation detail of the producer; a column a reader can scan for a
    // name is what a column is for.
    const columns = manaValueColumns([
      entryAt('Second Sight', 3, 1),
      entryAt('Ashen Rite', 3, 1),
      entryAt('Brackwater Toll', 3, 1),
    ]);
    expect(columns[0]?.members.map((entry) => entry.name)).toEqual([
      'Ashen Rite',
      'Brackwater Toll',
      'Second Sight',
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
    const sentence = (manaValue: number, cards: number): string =>
      groupHeadLabel({
        key: '',
        label: `Mana value ${String(manaValue)}`,
        cards,
        members: [],
        manaValue,
        symbol: String(manaValue),
      });
    expect(sentence(3, 1)).toBe('Mana value 3, 1 card');
    expect(sentence(0, 12)).toBe('Mana value 0, 12 cards');
  });
});

/**
 * How one pane's body says which density it is drawn at.
 *
 * The two densities are two components since `mtg-rgc.21` -- whole cards in
 * `../../src/routes/deck/CurveColumns.ts`, overlapping strips in
 * `../../src/routes/deck/StripColumns.ts` -- so the pane that was pressed is the
 * one publishing `data-view`, and the one beside it is still publishing
 * `data-density`. Read through a narrow structural interface because the
 * workspace tsconfig has no `lib: dom` and `getAttribute` is not typed here.
 */
function density(label: string): { readonly view: string | null; readonly density: string | null } {
  const body = screen.getByRole('group', { name: label }) as unknown as {
    readonly getAttribute: (name: string) => string | null;
  };
  return { view: body.getAttribute('data-view'), density: body.getAttribute('data-density') };
}

/** Switch one pane through its own control, the way a reader would. */
function switchPane(label: string, to: 'Full cards' | 'Compact list'): void {
  fireEvent.click(
    within(screen.getByRole('group', { name: `${label}, View` })).getByRole('button', { name: to }),
  );
}

/** The head sentence a column of these entries is announced with. */
function headOf(entries: readonly DeckArtifactEntry[], manaValue: number): string {
  const group = groupMembers(
    entries.filter((entry) => entry.manaValue === manaValue),
    (entry) => ({
      name: entry.name,
      manaValue: entry.manaValue,
      colorIdentity: entry.colorIdentity,
      typeLine: entry.typeLine,
      rarity: null,
    }),
    (entry) => entry.count,
    'manaValue',
  )[0];
  if (group === undefined) throw new Error(`no column at mana value ${String(manaValue)}`);
  return groupHeadLabel(group);
}

/**
 * How many illustrations a rendered container holds.
 *
 * The workspace tsconfig has no `lib: dom`, so the container carries no query
 * members and the narrowing happens at runtime, as every other assertion in this
 * package that reaches past testing-library's roles does.
 */
function artCount(container: unknown): number {
  const queryable = container as { readonly querySelectorAll?: (selector: string) => { length: number } };
  if (typeof queryable.querySelectorAll !== 'function') throw new Error('expected a rendered element');
  return queryable.querySelectorAll('.mtg-art').length;
}

describe('a compact pane drawn as strip columns', () => {
  it('builds a column per mana value, each named for a screen reader', () => {
    const { container } = render(
      h(DeckRoute, { state: { status: 'ready', deck: DECK }, open: OPEN_ARTIFACT }),
    );
    switchPane(MAIN_DECK_LABEL, 'Compact list');
    const main = [...DECK.spells, ...DECK.lands, ...DECK.basics];
    const values = [...new Set(main.map((entry) => entry.manaValue))].sort((a, b) => a - b);
    for (const value of values) {
      expect(screen.getByLabelText(headOf(main, value))).toBeTruthy();
    }
    // mtg-mxkrk. This pane has no density control at all and so is always
    // compact, and it drew an art window at the foot of every column until the
    // face slot was taken off the compact arm. Names, no pictures.
    expect(artCount(container)).toBe(0);
  });

  /**
   * The one gesture a compact pane offers must not undo what compact is.
   *
   * mtg-mxkrk took the picture off every compact surface, and the selection bar
   * is drawn in compact and nowhere else, so a tile hardcoded to the full
   * density there put a whole illustration back on screen the first time
   * somebody pressed a name strip -- which is the only thing there is to press.
   * Counted over the whole container rather than over the bar, because the
   * question is whether a picture is on the screen, not where it is.
   */
  it('draws no picture when a strip is selected, because the bar is compact too', () => {
    const { container } = render(
      h(DeckRoute, { state: { status: 'ready', deck: DECK }, open: OPEN_ARTIFACT }),
    );
    switchPane(MAIN_DECK_LABEL, 'Compact list');
    const pane = screen.getByRole('group', { name: `${MAIN_DECK_LABEL}, cards` });
    const [strip] = within(pane).getAllByRole('button');
    if (strip === undefined) throw new Error('the pane drew no strip');
    fireEvent.click(strip);
    expect(screen.getByRole('group', { name: /^Selected: /u })).toBeTruthy();
    expect(artCount(container)).toBe(0);
  });

  it('prints counts above the columns that sum to the pane’s own stated count', () => {
    store().setItem(deckViewStoreKey('main-deck'), 'compact');
    const html = renderToStaticMarkup(
      h(DeckRoute, { state: { status: 'ready', deck: DECK }, open: OPEN_ARTIFACT }),
    );
    const printed = [...html.matchAll(/class="mtg-strips__count"[^>]*>(\d+)</g)].map((hit) => Number(hit[1]));
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

  it('draws one strip per copy, so the number over a column counts what is under it', () => {
    const deck: DeckArtifact = {
      ...DECK,
      spells: [entryAt('Cinder Oath', 1, 4)],
      lands: [],
      basics: [],
    };
    store().setItem(deckViewStoreKey('main-deck'), 'compact');
    render(h(DeckRoute, { state: { status: 'ready', deck }, open: OPEN_ARTIFACT }));
    // Four copies are four pressable things, each saying which copy it is —
    // never four identical accessible names.
    for (let copy = 1; copy <= 4; copy += 1) {
      expect(screen.getByRole('button', { name: `Cinder Oath, copy ${String(copy)} of 4` })).toBeTruthy();
    }
  });

  it('drops the number over a lone column but keeps what the column is', () => {
    // A deck whose land slot took the whole list is one mana value, which after
    // `mtg-o5z1` is the shape a one-column pane arrives in: the pane is the deck.
    const deck: DeckArtifact = { ...DECK, spells: [], lands: [] };
    store().setItem(deckViewStoreKey('main-deck'), 'compact');
    const html = renderToStaticMarkup(
      h(DeckRoute, { state: { status: 'ready', deck }, open: OPEN_ARTIFACT }),
    );
    expect(manaValueColumns(DECK.basics)).toHaveLength(1);
    // The pane is still a column and still says what it is; it just has no
    // number over it, because the pane's own title already printed that number.
    expect(html).toContain(headOf(DECK.basics, 0));
    expect(html).not.toContain('mtg-strips__count');
  });

  it('keeps the number on a column holding one card, because that one has neighbors', () => {
    const deck: DeckArtifact = {
      ...DECK,
      spells: [entryAt('Cinder Oath', 1, 4), entryAt('Vaultbreaker', 5, 1)],
      lands: [],
      basics: [],
    };
    store().setItem(deckViewStoreKey('main-deck'), 'compact');
    const html = renderToStaticMarkup(
      h(DeckRoute, { state: { status: 'ready', deck }, open: OPEN_ARTIFACT }),
    );
    const printed = [...html.matchAll(/class="mtg-strips__count"[^>]*>(\d+)</g)].map((hit) => Number(hit[1]));
    expect(printed).toEqual([4, 1]);
  });

  it('draws full mode in the same columns, because the order is the point', () => {
    // Switched rather than assumed. A pane opens in compact since `mtg-ljda`, so
    // full is now the mode a reader asks for, and the store is how this file
    // asks for it without a click.
    //
    // `mtg-rgc.21`. Full used to flatten the groups into one wrapping run of
    // tiles, and it emitted them in mana-value order the whole time -- which is
    // exactly what a reader could not see, because a run that wraps has no
    // column boundaries and no counts over them.
    store().setItem(deckViewStoreKey('main-deck'), 'full');
    const html = renderToStaticMarkup(
      h(DeckRoute, { state: { status: 'ready', deck: DECK }, open: OPEN_ARTIFACT }),
    );
    expect(html).toContain('data-view="full"');
    expect(html).toContain('mtg-deck__column');
    const main = [...DECK.spells, ...DECK.lands, ...DECK.basics];
    for (const value of [...new Set(main.map((entry) => entry.manaValue))]) {
      expect(html).toContain(headOf(main, value));
    }
    // Whole cards, still: the columns are what changed, not the tile in them.
    expect(html).toContain('mtg-deck-card__reason');
  });

  it('switches only the pane whose control was pressed, columns and all', () => {
    const deck: DeckArtifact = { ...DECK, sideboard: [entryAt('Ashen Rite', 3, 2)] };
    render(h(DeckRoute, { state: { status: 'ready', deck }, open: OPEN_ARTIFACT }));
    switchPane('Sideboard', 'Compact list');
    // Both panes keep their columns since `mtg-rgc.21`, so the density is no
    // longer readable off the column count. It is readable off the pane bodies:
    // the one that was pressed draws whole cards and the one beside it still
    // draws strips.
    expect(screen.getAllByRole('group', { name: /^Mana value/ }).length).toBeGreaterThan(1);
    // The pane that was pressed draws strips, and the pane beside it still
    // draws whole cards: the density is per pane and only one control was
    // pressed. Both open on whole cards since 2026-09-17, so the press that
    // separates them is the one to compact.
    expect(density(`${MAIN_DECK_LABEL}, cards`)).toEqual({ view: 'full', density: null });
    expect(density('Sideboard, cards')).toEqual({ view: null, density: 'compact' });
  });
});

describe('the pane header, above the box rather than stuck inside it', () => {
  /*
   * `mtg-tz11`. Three of these used to describe the sticky header `mtg-n4d3`
   * shipped: that it was `position: sticky`, that its `top` cleared the app bar
   * rather than pinning to zero, and that it painted its own ground so cards did
   * not scroll through its text. All three were true, and all three were about a
   * header living inside the scrollport with the cards. The pane is a box now and
   * its header is a bar above that box, so what those assertions guarded is not
   * a rule any more: nothing scrolls under the header, so it needs no offset, no
   * stacking order and no opaque background.
   *
   * What replaces them is the arrangement that made them unnecessary. Two of the
   * three are about the sheet, which is all jsdom can answer; the third is about
   * the markup, and it is the one that would actually break first -- a header
   * moved inside the scrollport looks identical in a screenshot until you scroll.
   * What is deliberately not here is the rest of the sheet that makes the pane a
   * box. Every one of those declarations was mutated one at a time against
   * `../deck/deck-frame.browser.test.ts`, and a sheet-grep for a declaration a
   * browser cannot be made to miss is an assertion that cannot go red.
   */
  it('positions the pane header not at all, because nothing moves under it', () => {
    expect(DECK_CSS).toContain('.mtg-deck__pane-head {');
    const rule = DECK_CSS.slice(DECK_CSS.indexOf('.mtg-deck__pane-head {'));
    const body = rule.slice(0, rule.indexOf('}'));
    expect(body).not.toContain('position:');
    expect(body).not.toMatch(/top:/);
    expect(body).not.toContain('z-index:');
  });

  it('puts the scroll on the pane body', () => {
    const pane = DECK_CSS.slice(DECK_CSS.indexOf('.mtg-deck__pane-scroll {'));
    expect(pane.slice(0, pane.indexOf('}'))).toContain('overflow: auto');
  });

  it('draws the header before the pane body rather than inside it', () => {
    const html = renderToStaticMarkup(
      h(DeckRoute, { state: { status: 'ready', deck: DECK }, open: OPEN_ARTIFACT }),
    );
    const head = html.indexOf('class="mtg-deck__pane-head"');
    const scroll = html.indexOf('class="mtg-deck__pane-scroll"');
    expect(head).toBeGreaterThan(-1);
    expect(scroll).toBeGreaterThan(-1);
    expect(head).toBeLessThan(scroll);
    // And the head is closed before the scrollport opens: an ancestor would
    // also satisfy the ordering above and would scroll away with the cards.
    expect(html.slice(head, scroll)).toContain('</div>');
  });
});
