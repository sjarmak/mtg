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
import { DeckRoute, MAIN_DECK_LABEL, SIDEBOARD_LABEL } from '../../src/routes/DeckRoute';
import { deckTypeCounts, typeCountsLine } from '../../src/routes/deck/type-counts';
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

const LIBRARY_PRECONS = parsePreconFile({
  formatVersion: 1,
  setCode: 'LIB',
  decks: [
    {
      id: 'library-deck',
      name: 'Library Deck',
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

function renderDeck(): void {
  render(h(DeckRoute, { state: { status: 'ready', deck: DECK } }));
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
    expect(screen.getByRole('button', { name: /Library Deck/u })).toBeTruthy();
    expect(screen.getByText(/6 creatures · 6 noncreature spells · 28 lands/u)).toBeTruthy();
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
    const view = screen.getByRole('group', { name: 'Library Deck, View' });
    expect(
      (within(view).getByRole('button', { name: 'Full cards' }) as unknown as ElementLike).getAttribute(
        'aria-pressed',
      ),
    ).toBe('true');
    fireEvent.click(within(view).getByRole('button', { name: 'Compact list' }));
    expect(
      (screen.getByRole('group', { name: 'Library Deck cards' }) as unknown as ElementLike).getAttribute(
        'data-view',
      ),
    ).toBe('compact');
    expect(
      screen.getAllByText(/^MV [24]$/u).map((node) => (node as unknown as ElementLike).textContent),
    ).toEqual(['MV 2', 'MV 4']);
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
    renderDeck();
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
  it('renders every card, with its count', () => {
    renderDeck();
    for (const entry of DECK.spells) {
      expect(screen.getAllByText(entry.name).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText(/^\d+×$/).length).toBe(
      DECK.spells.length + DECK.lands.length + DECK.basics.length,
    );
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

  it('orders full cards by mana value as well as grouping compact cards by it', () => {
    renderDeck();
    // The whole run, not the spells alone: one pane holds the deck since
    // `mtg-o5z1`, so the lands are the ascending run's own zeroes rather than a
    // pane below it, and asserting on a slice would stop measuring the order.
    const values = screen
      .getAllByText(/^\d+×$/u)
      .map((count) => (count as unknown as ElementLike).closest('.mtg-deck-card'))
      .map((tile) => (tile as unknown as ElementLike).getAttribute('data-mana-value'));
    expect(values.length).toBe(DECK.spells.length + DECK.lands.length + DECK.basics.length);
    expect(values).toEqual([...values].sort((left, right) => Number(left) - Number(right)));
  });

  it('points the art at the store’s own Scryfall URLs rather than a guess', () => {
    const first = firstSpell();
    if (first.art === null) throw new Error('the fixture lost its art');
    const markup = renderToStaticMarkup(h(DeckTile, { entry: first }));
    expect(markup).toContain(first.art.src);
    expect(markup).toContain('data-art-state="ready"');
  });

  it('credits the illustrator, because the art is somebody else’s', () => {
    const first = firstSpell();
    const artist = first.art === null ? null : first.art.artist;
    if (artist === null) throw new Error('the fixture lost its artist credit');
    render(h(DeckTile, { entry: first }));
    expect(screen.getByText(new RegExp(artist))).toBeTruthy();
  });

  it('shows each inclusion’s reason and the criteria it cited', () => {
    renderDeck();
    const first = firstSpell();
    expect(screen.getByText(first.reason)).toBeTruthy();
    // Every card in this deck cites the same four criteria, so they are named
    // once above the cards rather than repeated on all forty tiles. The claim
    // is still on the page; it just is not on the tile. Asserted on markup
    // because this package has no `lib: dom`, per the note at the top.
    const html = renderToStaticMarkup(h(DeckRoute, { state: { status: 'ready', deck: DECK } }));
    const shared = html.match(/Every card here satisfies[^<]*/)?.[0] ?? '';
    for (const id of first.criteria) expect(shared).toContain(id);
  });
});

describe('the art slot under a dead URL', () => {
  it('falls back to the pending frame rather than leaving a blank box', () => {
    const first = firstSpell();
    if (first.art === null) throw new Error('the fixture lost its art');
    const { alt } = first.art;
    render(h(DeckTile, { entry: first }));
    expect(screen.queryByText(ART_PENDING_LABEL)).toBeNull();

    fireEvent.error(screen.getByRole('img', { name: alt }));
    expect(screen.getByText(ART_PENDING_LABEL)).toBeTruthy();
    expect(screen.getByLabelText(`${ART_PENDING_LABEL} for ${first.name}`)).toBeTruthy();
  });

  it('renders the pending frame for a card the store had no art for', () => {
    const first = firstSpell();
    render(h(DeckTile, { entry: { ...first, art: null } }));
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
    renderDeck();
    for (const report of DECK.manaBase.colors) {
      if (report.binding === null) continue;
      expect(screen.getAllByText(report.binding.cardName).length).toBeGreaterThan(0);
    }
  });

  it('shows the band each row was scored against, not one copied into the UI', () => {
    renderDeck();
    const cheapest = String(Math.floor(DECK.manaBase.castabilityTarget * 100));
    const heaviest = String(Math.floor(DECK.manaBase.heavyCastabilityTarget * 100));
    expect(screen.getByText(new RegExp(`cheapest requirement is held to ${cheapest}%`))).toBeTruthy();
    expect(screen.getByText(new RegExp(`requirement is held to ${heaviest}%`))).toBeTruthy();
  });

  it('says where the land count came from', () => {
    renderDeck();
    expect(screen.getByText(new RegExp(DECK.landPlan.reason.slice(0, 25)))).toBeTruthy();
  });

  it('prints the shortfalls the deck actually has', () => {
    renderDeck();
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

  it('starts full, because full is the page’s argument and compact is opting out of it', () => {
    const first = firstSpell();
    const markup = renderToStaticMarkup(h(DeckTile, { entry: first }));
    expect(markup).toContain('data-view="full"');
    expect(markup).toContain(first.reason);
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
    expect(renderToStaticMarkup(h(DeckTile, { entry: first }))).not.toContain(`title="${first.name}"`);
  });

  it('switches only the pane whose control was pressed', () => {
    const deck = withSideboard();
    render(h(DeckRoute, { state: { status: 'ready', deck } }));
    const main = screen.getByRole('group', { name: `${MAIN_DECK_LABEL}, View` });
    fireEvent.click(within(main).getByRole('button', { name: 'Compact list' }));

    // Queried by pressed state rather than read off the node: `getAttribute` is
    // a DOM property and this workspace has no `lib: dom`, per the note above.
    expect(within(main).getByRole('button', { name: 'Compact list', pressed: true })).toBeTruthy();
    // The main deck lost its reasons; the pane beside it still has its own.
    expect(screen.queryByText(firstSpell().reason)).toBeNull();
    const [aside] = deck.sideboard ?? [];
    if (aside === undefined) throw new Error('the deck lost its sideboard');
    expect(screen.getAllByText(aside.reason).length).toBeGreaterThan(0);
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
    expect(screen.getByText(/npm run lab/)).toBeTruthy();
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
