// @vitest-environment jsdom
/**
 * The deck page over the committed artifact.
 *
 * The fixture is a real deck built against the real store, so these assertions
 * are about a page a person actually gets: real card names, real Scryfall art,
 * and a mana base whose white is genuinely short. That shortfall is the reason
 * the fixture is worth committing — a page that only ever renders a deck where
 * everything is fine never shows whether the panel would say so.
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
import { parseCard } from '@mtg/dsl';
import type { CardInput } from '@mtg/dsl';
import { parsePreconFile } from '@mtg/deckbuild';
import { ART_PENDING_LABEL } from '../../src/card/ArtSlot';
import { readDeckArtifact } from '../../src/lab/deck-artifact';
import type { DeckArtifact, DeckArtifactEntry } from '../../src/lab/deck-artifact';
import {
  DECK_DETAILS_LABEL,
  DeckRoute,
  MAIN_DECK_LABEL,
  SIDEBOARD_LABEL,
  openDeckLabel,
} from '../../src/routes/DeckRoute';
import { deckTypeCounts, typeCountsLine } from '../../src/routes/deck/type-counts';
import { groupingLabel } from '../../src/routes/deck/grouping';
import { GROUPING_LABEL } from '../../src/routes/deck/GroupingControl';
import { DeckTile } from '../../src/routes/deck/DeckTile';
import { ManaBasePanel } from '../../src/routes/deck/ManaBasePanel';
import { DEFAULT_DECK_VIEW_MODE, deckViewStoreKey, readDeckViewMode } from '../../src/routes/deck/view-mode';

afterEach(cleanup);

/**
 * The preference store, reached through a structural interface because this
 * workspace has no `lib: dom` — the same shape and the same reason as
 * `../play/side-panel.test.ts`.
 */
interface StoreLike {
  clear(): void;
  setItem(key: string, value: string): void;
}

interface ElementLike {
  readonly getAttribute: (name: string) => string | null;
  readonly closest: (selector: string) => ElementLike | null;
  readonly textContent: string | null;
}

function store(): StoreLike {
  const host = globalThis as { readonly localStorage?: unknown };
  if (typeof host.localStorage !== 'object' || host.localStorage === null) {
    throw new Error('no preference store');
  }
  return host.localStorage as StoreLike;
}

// The density is persisted, so a test that switched a pane would otherwise hand
// the next test a page already switched. Cleared before each rather than after,
// so a run that stops mid-file leaves nothing behind either.
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

const LIBRARY_CARDS = [
  parseCard({
    kind: 'creature',
    id: 'library-creature',
    name: 'Library Creature',
    rarity: 'common',
    set: { code: 'LIB', collectorNumber: 1 },
    manaCost: { generic: 1, G: 1 },
    colors: ['G'],
    power: 2,
    toughness: 2,
  } satisfies CardInput),
  parseCard({
    kind: 'instant',
    id: 'library-spell',
    name: 'Library Spell',
    rarity: 'common',
    set: { code: 'LIB', collectorNumber: 2 },
    manaCost: { generic: 3, G: 1 },
    colors: ['G'],
    effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
  } satisfies CardInput),
];

/** The one written deck those cards make, named once so a query cannot drift. */
const LIBRARY_DECK_NAME = 'Library Deck';

const LIBRARY_PRECONS = parsePreconFile({
  formatVersion: 1,
  setCode: 'LIB',
  decks: [
    {
      id: 'library-deck',
      name: LIBRARY_DECK_NAME,
      plan: 'Show the staged deck library.',
      payoff: 'library-creature',
      deckSize: 40,
      basics: { G: 28 },
      spells: [
        { id: 'library-creature', count: 6 },
        { id: 'library-spell', count: 6 },
      ],
    },
  ],
});

function firstSpell(): DeckArtifactEntry {
  const [first] = DECK.spells;
  if (first === undefined) throw new Error('the fixture has no spells');
  return first;
}

/**
 * The page with the artifact deck open, which is a click since `mtg-nuk3`.
 *
 * The tab lands on the library and an open deck takes the whole route, so a
 * test about a deck's panes has to say which deck it opened. Pressing the tile
 * is how a person gets there and is therefore what these tests do; the artifact
 * deck is named by its prompt, the way its tile is.
 */
function openArtifact(): void {
  fireEvent.click(screen.getByRole('button', { name: openDeckLabel(DECK.prompt) }));
}

function renderDeck(): void {
  render(h(DeckRoute, { state: { status: 'ready', deck: DECK } }));
  openArtifact();
}

/**
 * The same page with its panes switched to full cards.
 *
 * A pane opens in compact since `mtg-ljda`, and compact is a decklist: it draws
 * no art, no illustrator credit, no price and no inclusion reason
 * (`../../src/routes/deck/DeckTile.ts` lists what it subtracts). Every test that
 * asserts on one of those is a test about the full tile, so it says so here
 * rather than inheriting whichever mode is the default this month — which is how
 * five of them came to be measuring the default instead of the tile.
 */
function renderDeckFull(): void {
  for (const pane of ['main-deck', 'sideboard']) store().setItem(deckViewStoreKey(pane), 'full');
  renderDeck();
}

/**
 * The same page with its panes switched to the name strips.
 *
 * The mirror of `renderDeckFull`, and needed for the same reason from the other
 * side: a pane opens on whole cards again since 2026-09-17
 * (`../../src/routes/deck/DeckPane.ts`'s `PANE_CARD_VIEWS`), so a test about the
 * strips states the density it is about instead of inheriting this month's
 * default.
 */
function renderDeckCompact(): void {
  for (const pane of ['main-deck', 'sideboard']) store().setItem(deckViewStoreKey(pane), 'compact');
  renderDeck();
}

/**
 * The same page with the details panel open.
 *
 * `mtg-z4q6`: the plan, the shared criteria and the mana base sit behind the
 * head's own button, so the page opens on the cards. Every test that asserts on
 * one of those three says so here rather than reading a closed page — which is
 * the same reason `renderDeckFull` exists one function up.
 */
function renderDeckDetails(): void {
  renderDeck();
  fireEvent.click(screen.getByRole('button', { name: DECK_DETAILS_LABEL }));
}

/**
 * The same deck with cards set aside, so the page draws its second pane.
 *
 * The committed fixture carries no sideboard and should not: `@mtg/decklab`
 * proposes exactly the deck and leaves nothing over, so an artifact with one
 * would be a fact about the build that never happened. A case that is about two
 * panes states the second one here instead.
 */
function withSideboard(): DeckArtifact {
  const [first, second] = DECK.spells;
  if (first === undefined || second === undefined) throw new Error('the fixture has too few spells');
  return { ...DECK, sideboard: [{ ...second, count: 2 }] };
}

function renderWithSideboard(): void {
  render(h(DeckRoute, { state: { status: 'ready', deck: withSideboard() } }));
  openArtifact();
}

describe('the committed deck fixture', () => {
  it('is a legal-sized deck whose every card carries art, so the page is not mostly hatching', () => {
    const entries = [...DECK.spells, ...DECK.lands, ...DECK.basics];
    expect(entries.reduce((sum, entry) => sum + entry.count, 0)).toBe(60);
    expect(entries.filter((entry) => entry.art === null)).toEqual([]);
  });

  it('exercises both castability bands, which is why it is the fixture', () => {
    const targets = new Set(DECK.manaBase.colors.map((report) => report.binding?.target));
    expect(targets.has(DECK.manaBase.castabilityTarget)).toBe(true);
    expect(targets.has(DECK.manaBase.heavyCastabilityTarget)).toBe(true);
  });
});

describe('rendering a deck', () => {
  it('shows staged preconstructed decks even when no database deck artifact was staged', () => {
    render(
      h(DeckRoute, {
        state: { status: 'absent' },
        precons: { status: 'ready', file: LIBRARY_PRECONS },
        cards: LIBRARY_CARDS,
      }),
    );
    expect(screen.getByRole('heading', { name: 'Decks' })).toBeTruthy();
    const tile = screen.getByRole('button', { name: openDeckLabel(LIBRARY_DECK_NAME) });
    // Both surfaces say this, and that is the point: the tile's counts line and
    // the opened deck's section note used to disagree about the middle number,
    // because the tile printed every nonland card as a "spell" while the note
    // subtracted the creatures. Both are asserted, so a future edit that moves
    // one of them fails here rather than shipping the contradiction again.
    //
    // Read on either side of the click rather than from one query, because
    // `mtg-nuk3` gave an open deck the whole route and the two no longer share
    // a screen. The guard is the same claim: one line, printed identically
    // wherever the deck is described.
    const line = /6 creatures · 6 noncreature spells · 28 lands/u;
    expect(screen.getAllByText(line).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(tile);
    expect(screen.getAllByText(line).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('No deck staged')).toBeNull();
  });

  it('makes full-card and compact-list views explicit for a selected staged deck', () => {
    render(
      h(DeckRoute, {
        state: { status: 'absent' },
        precons: { status: 'ready', file: LIBRARY_PRECONS },
        cards: LIBRARY_CARDS,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: openDeckLabel(LIBRARY_DECK_NAME) }));
    // Named for the pane rather than for the deck since `mtg-pmpu`: this is the
    // one pane component now, and it names its controls the way the artifact
    // route's panes do. The deck's own name is at the head of the screen.
    const view = screen.getByRole('group', { name: `${MAIN_DECK_LABEL}, View` });
    // Whole cards on opening since 2026-09-17, which is what the deck view opens
    // on everywhere (`../../src/routes/deck/DeckPane.ts`'s `PANE_CARD_VIEWS`).
    expect(
      (within(view).getByRole('button', { name: 'Full cards' }) as unknown as ElementLike).getAttribute(
        'aria-pressed',
      ),
    ).toBe('true');
    // The other half of the control, which is what the rest of this case reads:
    // the strips are what compact draws, and a control that quietly did nothing
    // would pass a test that never pressed it.
    fireEvent.click(within(view).getByRole('button', { name: 'Compact list' }));
    // One strip per copy, the way every other deck pane on the site draws one.
    // Twelve here and not two: this pane drew a column of *faces* per mana value
    // until a written deck from a generated set was the one deck in the lab
    // organized differently from the rest, and a face carried a copy count
    // beside it rather than being one of the copies. The count above the column
    // now counts the things under it, which is the assertion two lines down.
    const cards = screen.getByRole('group', {
      name: `${LIBRARY_DECK_NAME} cards`,
    }) as unknown as { readonly querySelectorAll: (selector: string) => { readonly length: number } };
    expect(cards.querySelectorAll('.mtg-strips__card').length).toBe(12);
    // mtg-xzxs folded this pane's own copy of the grouping into
    // `routes/deck/columns.ts`, and the fold is only safe if this test still
    // measures the pane rather than trusting the shared rule's own test. So the
    // assertions are the two things the copy did: it sorted a precon's spells
    // into columns by mana value, and it summed the *counts* beside those
    // spells rather than counting the spells. Six of each here, so a pane that
    // counted entries would say 1 and 1 and still draw the same two columns.
    expect(
      screen
        .getAllByRole('group', { name: /^Mana value/u })
        .map((node) => (node as unknown as ElementLike).getAttribute('aria-label')),
    ).toEqual(['Mana value 2, 6 cards', 'Mana value 4, 6 cards']);
    expect(screen.getAllByText(/^6$/u).map((node) => (node as unknown as ElementLike).textContent)).toEqual([
      '6',
      '6',
    ]);
  });

  it('shows the prompt it was built from and what it costs', () => {
    // Full, because the price is on the tile's foot and compact has no foot.
    renderDeckFull();
    expect(screen.getByText(new RegExp(DECK.prompt.slice(0, 20)))).toBeTruthy();
    expect(screen.getAllByText(/\$\d+\.\d\d/).length).toBeGreaterThan(0);
  });

  // mtg-90x.3: the universe size printed unbroken (`8755`) while every count
  // on the Analysis route already goes through `integer`'s thousands
  // separator. Same class of number, same package, one formatter.
  it('formats the universe size with the thousands separator the rest of the app uses', () => {
    renderDeck();
    expect(String(DECK.universeSize)).not.toBe(DECK.universeSize.toLocaleString('en-US'));
    const formatted = DECK.universeSize.toLocaleString('en-US');
    expect(screen.getByText(new RegExp(`chosen from the ${formatted} the criteria allow`))).toBeTruthy();
  });

  // A name can legitimately appear twice: once as a tile, once as the card that
  // set a color's floor in the panel below.
  // Compact drew a tile per distinct card with a `4×` badge on it until
  // `mtg-ar3c`; it now draws one strip per copy, so the count above a column
  // counts the objects under it rather than a badge on one of them. The
  // assertion is the same claim it always was — every card is on the page and
  // its count is stated — read off what the pane now says instead.
  it('draws one strip per copy, so a column counts the things under it', () => {
    renderDeckCompact();
    const region = screen.getByRole('group', { name: `${MAIN_DECK_LABEL}, cards` });
    const drawn = within(region)
      .getAllByRole('button')
      .map((node) => (node as unknown as ElementLike).getAttribute('aria-label'));
    // `deck/strips.ts`'s `stripLabel`, spelled out rather than imported: a test
    // that asked the code under test how to name a copy would pass whatever it
    // renamed them to.
    const expected = [...DECK.spells, ...DECK.lands, ...DECK.basics].flatMap((entry) =>
      Array.from({ length: entry.count }, (_, index) =>
        entry.count === 1 ? entry.name : `${entry.name}, copy ${String(index + 1)} of ${String(entry.count)}`,
      ),
    );
    expect(drawn.length).toBe(DECK.totalCards);
    expect([...drawn].sort()).toEqual([...expected].sort());
  });

  // mtg-z4q6. The measurement behind it is `tools/deck-density.ts`'s: the plan,
  // the shared criteria and the mana base are 396px of prose above cards that
  // are read continuously, and the page opened on none of them.
  it('opens on the cards, with the deck’s prose behind the head’s own button', () => {
    renderDeck();
    expect(screen.queryByText(DECK.plan)).toBeNull();
    expect(screen.queryByText(/^Every card here satisfies/u)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Mana base' })).toBeNull();
    // The counts are the half that is read continuously, so they never leave.
    expect(
      screen.getByRole('heading', { name: `${MAIN_DECK_LABEL}: ${String(DECK.totalCards)}` }),
    ).toBeTruthy();

    const button = screen.getByRole('button', { name: DECK_DETAILS_LABEL });
    expect((button as unknown as ElementLike).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect((button as unknown as ElementLike).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(DECK.plan)).toBeTruthy();
    expect(screen.getByText(/^Every card here satisfies/u)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Mana base' })).toBeTruthy();

    // It closes again, which is what makes it a disclosure rather than a link
    // to a page the reader cannot leave.
    fireEvent.click(button);
    expect(screen.queryByText(DECK.plan)).toBeNull();
  });

  it('splits the pane by type in its own header, the numbers summing to its title', () => {
    renderDeck();
    const counts = deckTypeCounts([...DECK.spells, ...DECK.lands, ...DECK.basics]);
    expect(counts.lands + counts.creatures + counts.other).toBe(DECK.totalCards);
    expect(screen.getByText(new RegExp(typeCountsLine(counts)))).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: `${MAIN_DECK_LABEL}: ${String(DECK.totalCards)}` }),
    ).toBeTruthy();
  });

  it('orders full cards by mana value', () => {
    // Full, because the flat run of tiles is the only place an order is a run.
    // The whole run, not the spells alone: one pane holds the deck since
    // `mtg-o5z1`, so the lands are the ascending run's own zeroes rather than a
    // pane below it, and asserting on a slice would stop measuring the order.
    renderDeckFull();
    const values = screen
      .getAllByText(/^\d+×$/u)
      .map((count) => (count as unknown as ElementLike).closest('.mtg-deck-card'))
      .map((tile) => (tile as unknown as ElementLike).getAttribute('data-mana-value'));
    expect(values.length).toBe(DECK.spells.length + DECK.lands.length + DECK.basics.length);
    expect(values).toEqual([...values].sort((left, right) => Number(left) - Number(right)));
  });

  it('columns compact cards by mana value, ascending, with no empty column', () => {
    renderDeck();
    const heads = screen
      .getAllByRole('group', { name: /^Mana value/u })
      .map((node) => (node as unknown as ElementLike).getAttribute('aria-label') ?? '');
    const values = heads.map((label) => Number(/^Mana value (\d+)/u.exec(label)?.[1]));
    expect(values.length).toBeGreaterThan(1);
    expect(values).toEqual([...values].sort((left, right) => left - right));
    // Present values only. An empty column claims a card belongs there, and the
    // deck's counts have to sum to the pane's own title either way.
    const cards = heads.map((label) => Number(/, (\d+) cards?$/u.exec(label)?.[1]));
    expect(cards.reduce((sum, count) => sum + count, 0)).toBe(DECK.totalCards);
    expect(cards.every((count) => count > 0)).toBe(true);
  });

  it('points the art at the store’s own Scryfall URLs rather than a guess', () => {
    const first = firstSpell();
    if (first.art === null) throw new Error('the fixture lost its art');
    const markup = renderToStaticMarkup(h(DeckTile, { entry: first, mode: 'full' }));
    expect(markup).toContain(first.art.src);
    expect(markup).toContain('data-art-state="ready"');
  });

  it('credits the illustrator, because the art is somebody else’s', () => {
    const first = firstSpell();
    const artist = first.art === null ? null : first.art.artist;
    if (artist === null) throw new Error('the fixture lost its artist credit');
    render(h(DeckTile, { entry: first, mode: 'full' }));
    expect(screen.getByText(new RegExp(artist))).toBeTruthy();
  });

  it('shows each inclusion’s reason and the criteria it cited', () => {
    // Full, because the reason is the region compact drops — that subtraction is
    // the whole of what a reader gives up by opening on the columns.
    renderDeckFull();
    fireEvent.click(screen.getByRole('button', { name: DECK_DETAILS_LABEL }));
    const first = firstSpell();
    expect(screen.getByText(first.reason)).toBeTruthy();
    // Every card in this deck cites the same four criteria, so they are named
    // once above the cards rather than repeated on all forty tiles. The claim
    // is still on the page; it just is not on the tile. Read off the rendered
    // page rather than off a second `renderToStaticMarkup` of the route: since
    // `mtg-nuk3` the route arrives on the library, so a markup render with no
    // click describes no deck at all.
    const shared = screen.getByText(/^Every card here satisfies/u) as unknown as ElementLike;
    for (const id of first.criteria) expect(shared.textContent ?? '').toContain(id);
  });
});

describe('the art slot under a dead URL', () => {
  it('falls back to the pending frame rather than leaving a blank box', () => {
    const first = firstSpell();
    if (first.art === null) throw new Error('the fixture lost its art');
    const { alt } = first.art;
    render(h(DeckTile, { entry: first, mode: 'full' }));
    expect(screen.queryByText(ART_PENDING_LABEL)).toBeNull();

    fireEvent.error(screen.getByRole('img', { name: alt }));
    expect(screen.getByText(ART_PENDING_LABEL)).toBeTruthy();
    expect(screen.getByLabelText(`${ART_PENDING_LABEL} for ${first.name}`)).toBeTruthy();
  });

  it('renders the pending frame for a card the store had no art for', () => {
    const first = firstSpell();
    render(h(DeckTile, { entry: { ...first, art: null }, mode: 'full' }));
    expect(screen.getByLabelText(`${ART_PENDING_LABEL} for ${first.name}`)).toBeTruthy();
  });
});

describe('the mana base panel', () => {
  it('prints every color with its sources, its floor and its castability', () => {
    // Read out of the rendered markup rather than by walking up to the row:
    // `closest` and `textContent` are DOM properties, and this workspace has no
    // `lib: dom` to type them (see `card.test.ts`).
    const rows = renderToStaticMarkup(h(ManaBasePanel, { deck: DECK })).split('<tr');
    for (const report of DECK.manaBase.colors) {
      const row = rows.find((fragment) => fragment.includes(`>${report.color}</span>`));
      if (row === undefined) throw new Error(`no row for ${report.color}`);
      expect(row).toContain(`>${String(report.sources)}</td>`);
      expect(row).toContain(`>${String(report.sourceFloor)}</td>`);
      expect(row).toContain(`${String(Math.floor(report.castability * 100))}%`);
    }
  });

  // mtg-90x.3: pip counts are whole numbers (the fixture's W and R rows are 4
  // and 44) but printed as `4.0` and `44.0`. Weighted demand is the genuinely
  // fractional figure and keeps its decimal.
  it('prints a whole pip count as a whole number, leaving weighted demand fractional', () => {
    const rows = renderToStaticMarkup(h(ManaBasePanel, { deck: DECK })).split('<tr');
    for (const report of DECK.manaBase.colors) {
      expect(Number.isInteger(report.pipCount)).toBe(true); // the fixture invariant this test relies on
      const row = rows.find((fragment) => fragment.includes(`>${report.color}</span>`));
      if (row === undefined) throw new Error(`no row for ${report.color}`);
      expect(row).toContain(`>${String(report.pipCount)}</td>`);
      expect(row).not.toContain(`>${report.pipCount.toFixed(1)}</td>`);
      expect(row).toContain(`>${report.weightedDemand.toFixed(1)}</td>`);
    }
  });

  it('keeps a genuinely fractional pip count fractional rather than rounding it away', () => {
    const [firstColor, ...restColors] = DECK.manaBase.colors;
    if (firstColor === undefined) throw new Error('the fixture has no colors');
    const fractional: DeckArtifact = {
      ...DECK,
      manaBase: { ...DECK.manaBase, colors: [{ ...firstColor, pipCount: 4.5 }, ...restColors] },
    };
    const rows = renderToStaticMarkup(h(ManaBasePanel, { deck: fractional })).split('<tr');
    const row = rows.find((fragment) => fragment.includes(`>${firstColor.color}</span>`));
    if (row === undefined) throw new Error(`no row for ${firstColor.color}`);
    expect(row).toContain('>4.5</td>');
  });

  // mtg-90x.3: the caption used to state the land count twice in consecutive
  // sentences ("20 lands: 12 basic, 8 nonbasic. 20 lands, chosen for this
  // deck: ..."). The basic/nonbasic split now folds into the same clause as
  // the count, and the reason still closes in `describeLandCount`'s words.
  it('says the land count once instead of twice in consecutive sentences', () => {
    const html = renderToStaticMarkup(h(ManaBasePanel, { deck: DECK }));
    const totalLands = String(DECK.manaBase.totalLands);
    const basics = DECK.manaBase.totalLands - DECK.manaBase.nonBasicLands;
    // The old copy stated the count twice back to back: "20 lands: 12 basic, 8
    // nonbasic. 20 lands, chosen for this deck: ...". That seam is gone; the
    // reason text may still mention the count in its own words, which is not
    // the bug this guards against.
    expect(html).not.toContain(`nonbasic. ${totalLands} lands,`);
    expect(html).toContain(
      `${totalLands} lands (${String(basics)} basic, ${String(DECK.manaBase.nonBasicLands)} nonbasic), chosen for this deck: ${DECK.landPlan.reason}`,
    );
  });

  // mtg-90x.3 follow-up: `landPlan.count` (the judgment made before assembly)
  // and `manaBase.totalLands` (what assembly actually built) are independent
  // fields with nothing constraining them to agree — `assembleDeck`'s
  // `Math.max(0, criteria.landCount - nonBasicLands)` clamp lets the built
  // total run past the plan once the nonbasic lands alone exceed it. No
  // committed fixture exercises that gap (the boros-aggro fixture's plan and
  // total are both 20), so it is built here.
  it('names the plan separately from the built total when they disagree', () => {
    const divergent: DeckArtifact = {
      ...DECK,
      landPlan: { ...DECK.landPlan, count: 20 },
      manaBase: { ...DECK.manaBase, totalLands: 23, nonBasicLands: 23 },
    };
    const html = renderToStaticMarkup(h(ManaBasePanel, { deck: divergent }));
    // Both counts are on the page, and the reason sits with the plan it
    // actually explains rather than the total the assembler was forced past
    // it into building.
    expect(html).toContain('23 lands (0 basic, 23 nonbasic); the plan called for 20,');
    expect(html).toContain(`the plan called for 20, chosen for this deck: ${divergent.landPlan.reason}`);
    // The false-attribution shape this guards against: the built total
    // stated immediately before the plan's reason, as though the reason
    // justified the number that follows "lands (".
    expect(html).not.toContain('23 lands (0 basic, 23 nonbasic), chosen for this deck:');
  });

  it('names the card that set each floor, which is the whole point of the panel', () => {
    renderDeckDetails();
    for (const report of DECK.manaBase.colors) {
      if (report.binding === null) continue;
      expect(screen.getAllByText(report.binding.cardName).length).toBeGreaterThan(0);
    }
  });

  it('shows the band each row was scored against, not one copied into the UI', () => {
    renderDeckDetails();
    const cheapest = String(Math.floor(DECK.manaBase.castabilityTarget * 100));
    const heaviest = String(Math.floor(DECK.manaBase.heavyCastabilityTarget * 100));
    expect(screen.getByText(new RegExp(`cheapest requirement is held to ${cheapest}%`))).toBeTruthy();
    expect(screen.getByText(new RegExp(`requirement is held to ${heaviest}%`))).toBeTruthy();
  });

  it('says where the land count came from', () => {
    renderDeckDetails();
    expect(screen.getByText(new RegExp(DECK.landPlan.reason.slice(0, 25)))).toBeTruthy();
  });

  it('prints the shortfalls the deck actually has', () => {
    renderDeckDetails();
    expect(DECK.shortfalls.length).toBeGreaterThan(0);
    for (const shortfall of DECK.shortfalls) expect(screen.getByText(shortfall)).toBeTruthy();
  });
});

/**
 * The per-pane density control.
 *
 * **None of these assertions is about a pixel, and none of them could be.**
 * jsdom performs no layout, so `getBoundingClientRect` is all zeros here and the
 * questions "how many cards fit" and "does a name clip" are unanswerable in this
 * file by construction. What is answerable, and what is asserted, is everything
 * upstream of layout: which regions the tile builds, that the control switches
 * them, that each pane switches only itself, and that the choice survives a
 * remount through the store. The density was measured in
 * chrome-headless-shell 151 over `packages/ui/tools/deck-density.ts`, and that
 * tool's docblock carries the numbers.
 */
/**
 * A built artifact's entries carry no rarity, so this pane offers three axes
 * where a pane of DSL cards offers four (`mtg-6599`; the four are asserted in
 * `../deck/constructed-builder.test.ts`). Withholding it rather than drawing an
 * `Unknown rarity` column is `../../src/routes/deck/GroupingControl.ts`'s rule.
 */
describe('the grouping control', () => {
  function options(pane: string): readonly string[] {
    const control = screen.getByRole('combobox', { name: `${pane}, ${GROUPING_LABEL}` });
    return within(control)
      .getAllByRole('option')
      .map((option) => (option as unknown as ElementLike).textContent ?? '');
  }

  it('offers three axes, withholding the one the entries cannot answer', () => {
    renderDeck();
    expect(options(MAIN_DECK_LABEL)).toEqual([
      groupingLabel('manaValue'),
      groupingLabel('color'),
      groupingLabel('cardType'),
    ]);
    expect(options(MAIN_DECK_LABEL)).not.toContain(groupingLabel('rarity'));
  });

  it('regroups the columns, and the heads still sum to the pane', () => {
    renderDeck();
    fireEvent.change(screen.getByRole('combobox', { name: `${MAIN_DECK_LABEL}, ${GROUPING_LABEL}` }), {
      target: { value: 'color' },
    });
    const region = screen.getByRole('group', { name: `${MAIN_DECK_LABEL}, cards` });
    const heads = within(region)
      .getAllByRole('group')
      .map((group) => (group as unknown as ElementLike).getAttribute('aria-label') ?? '')
      .filter((label) => / \d+ cards?$/u.test(label));
    expect(heads.length).toBeGreaterThan(0);
    const counted = heads.reduce((sum, label) => sum + Number(/ (\d+) cards?$/u.exec(label)?.[1] ?? '0'), 0);
    const cards = [...DECK.spells, ...DECK.lands, ...DECK.basics].reduce(
      (sum, entry) => sum + entry.count,
      0,
    );
    expect(counted).toBe(cards);
  });

  // `mtg-pmpu`. This case read the other way round: the control was hidden over
  // the full grid, because the grid ordered itself by mana value whatever the
  // control said. A control that is present and inert is worse than one that is
  // not there, and that was the argument for taking it away -- a real problem
  // answered by removing the control rather than by making it work. The grid now
  // reads the pane's grouping, columns flattened, so Sort is the pane's order at
  // both densities and Display is how a card in it is drawn.
  it('sorts the full grid too, so one control means one thing at both densities', () => {
    renderDeckFull();
    fireEvent.change(screen.getByRole('combobox', { name: `${MAIN_DECK_LABEL}, ${GROUPING_LABEL}` }), {
      target: { value: 'color' },
    });
    const identities = screen
      .getAllByText(/^\d+×$/u)
      .map((count) => (count as unknown as ElementLike).closest('.mtg-deck-card'))
      .map((tile) => (tile as unknown as ElementLike).getAttribute('data-identity') ?? '');
    expect(identities.length).toBeGreaterThan(0);
    // Each color is one run of tiles rather than several: a grid ordered by the
    // grouping keeps a bucket's members together, which is the whole of what the
    // control now claims at this density.
    const runs = identities.filter((identity, index) => identity !== identities[index - 1]);
    expect(runs.length).toBe(new Set(identities).size);
    expect(runs.length).toBeGreaterThan(1);
  });
});

describe('the density control', () => {
  it('draws full and compact as one named control on each pane, pressed where it is', () => {
    renderWithSideboard();
    expect(screen.getByRole('group', { name: `${MAIN_DECK_LABEL}, View` })).toBeTruthy();
    // Both panes carry their own control, which is the per-pane architecture the
    // MTGO capture shows and the reason the preference is stored per pane.
    expect(screen.getAllByRole('group', { name: /, View$/ }).length).toBe(2);
    expect(screen.getAllByRole('button', { name: 'Full cards', pressed: true }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Compact list', pressed: false }).length).toBeGreaterThan(0);
  });

  it('starts compact, because the columns are the layout the page is copying', () => {
    // `mtg-ljda`. This assertion used to read the other way, and the sentence it
    // carried — full is the page's argument, compact is opting out of it — was
    // written when the two modes were one layout at two densities. Compact is
    // now the mana-value columns, so the default is a layout rather than a
    // density, and the layout to open on is the one being copied.
    const first = firstSpell();
    const markup = renderToStaticMarkup(h(DeckTile, { entry: first }));
    expect(markup).toContain('data-view="compact"');
    expect(markup).not.toContain(first.reason);
  });

  it('drops the picture, the reason and the credit in compact, and keeps the head and type', () => {
    const first = firstSpell();
    if (first.art === null) throw new Error('the fixture lost its art');
    const compact = renderToStaticMarkup(h(DeckTile, { entry: first, mode: 'compact' }));
    expect(compact).toContain('data-view="compact"');
    expect(compact).toContain(first.name);
    expect(compact).toContain(first.typeLine);
    expect(compact).toContain(`${String(first.count)}×`);
    // The three regions compact subtracts. The credit goes with the picture it
    // credits, which is the one place this parts from `COMPACT_REGIONS`.
    expect(compact).not.toContain(first.art.src);
    expect(compact).not.toContain(first.reason);
    expect(compact).not.toContain('mtg-deck-card__foot');
  });

  it('keeps the whole name in the tree when the strip clips it, plus in the hover attribute', () => {
    const first = firstSpell();
    const compact = renderToStaticMarkup(h(DeckTile, { entry: first, mode: 'compact' }));
    expect(compact).toContain(`title="${first.name}"`);
    // A full tile has a column's width and needs no attribute standing in for it.
    expect(renderToStaticMarkup(h(DeckTile, { entry: first, mode: 'full' }))).not.toContain(
      `title="${first.name}"`,
    );
  });

  it('switches only the pane whose control was pressed', () => {
    // The set-aside card gets a reason of its own, because `withSideboard` sets
    // aside a copy of a main-deck spell and the two would otherwise share the
    // string this test looks for in one pane and not the other.
    const base = withSideboard();
    const [copy] = base.sideboard ?? [];
    if (copy === undefined) throw new Error('the deck lost its sideboard');
    const deck: DeckArtifact = { ...base, sideboard: [{ ...copy, reason: 'Set aside for the mirror' }] };
    render(h(DeckRoute, { state: { status: 'ready', deck } }));
    openArtifact();
    const main = screen.getByRole('group', { name: `${MAIN_DECK_LABEL}, View` });
    fireEvent.click(within(main).getByRole('button', { name: 'Compact list' }));

    // Queried by pressed state rather than read off the node: `getAttribute` is
    // a DOM property and this workspace has no `lib: dom`, per the note above.
    expect(within(main).getByRole('button', { name: 'Compact list', pressed: true })).toBeTruthy();
    // The main deck lost its reasons; the pane beside it still has its own,
    // which is what a per-pane control is for. Pressed the other way since both
    // panes open on whole cards (2026-09-17).
    expect(screen.queryByText(firstSpell().reason)).toBeNull();
    expect(screen.getAllByText('Set aside for the mirror').length).toBeGreaterThan(0);
  });

  it('remembers each pane’s choice across a remount, so a reload does not undo it', () => {
    renderWithSideboard();
    fireEvent.click(
      within(screen.getByRole('group', { name: `${MAIN_DECK_LABEL}, View` })).getByRole('button', {
        name: 'Compact list',
      }),
    );
    cleanup();
    renderWithSideboard();
    const main = screen.getByRole('group', { name: `${MAIN_DECK_LABEL}, View` });
    expect(within(main).getByRole('button', { name: 'Compact list', pressed: true })).toBeTruthy();
    const side = screen.getByRole('group', { name: `${SIDEBOARD_LABEL}, View` });
    expect(within(side).getByRole('button', { name: 'Full cards', pressed: true })).toBeTruthy();
  });

  it('reads a store holding something that is not a mode as a store holding nothing', () => {
    store().setItem(deckViewStoreKey('main-deck'), 'enormous');
    expect(readDeckViewMode('main-deck')).toBe(DEFAULT_DECK_VIEW_MODE);
  });
});

describe('when there is no deck', () => {
  it('tells you the command instead of showing an empty page', () => {
    render(h(DeckRoute, { state: { status: 'absent' } }));
    expect(screen.getByText('No deck staged')).toBeTruthy();
    // Two commands, since the launcher stopped falling back to the committed
    // fixture: the one that builds a deck, and the one that opens that fixture
    // by name. `npm run lab` is in both, so this asks for all of them.
    expect(screen.getByText(/packages\/decklab\/src\/cli\.ts/)).toBeTruthy();
    expect(screen.getAllByText(/npm run lab/).length).toBeGreaterThan(0);
  });

  it('shows the field that failed when the document is not a deck', () => {
    // The message names a field, so the field renders as code and the sentence
    // is split across elements. Asserted on the markup, per the note above.
    const html = renderToStaticMarkup(
      h(DeckRoute, { state: { status: 'failed', message: 'deck.json is stale at `version`' } }),
    );
    expect(html).toContain('deck.json is stale at <code class="mtg-code">version</code>');
  });
});
