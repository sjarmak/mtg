// @vitest-environment jsdom
/**
 * The two panes the deck page splits into, and the line each one's header says.
 *
 * `mtg-o5z1`. The page used to split three ways by card class; the capture
 * splits two ways by where a card is. What is checkable here is everything
 * upstream of layout: that the deck arrives as one pane rather than three, that
 * the count in a pane's title is the count of what it holds, that the stats line
 * partitions that same number, and that the two panes still carry one density
 * control each. **Nothing here proves a pixel** — jsdom performs no layout, so
 * whether the two panes fit side by side is unanswerable in vitest and the sheet
 * argues its own breakpoint in `../../src/styles/deck.ts`.
 *
 * Card names are invented rather than borrowed, per `AGENTS.md`'s public
 * boundary, and inventing them is also what lets a case state its own type line
 * instead of hunting the fixture for a printing that happens to be a land.
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
import { DeckRoute, MAIN_DECK_LABEL, SIDEBOARD_LABEL } from '../../src/routes/DeckRoute';
import { deckTypeCounts, typeCountsLine } from '../../src/routes/deck/type-counts';

afterEach(cleanup);

interface StoreLike {
  clear(): void;
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

/** An entry of a stated name, type line and count, built off the fixture's shape. */
function entry(name: string, typeLine: string, count: number): DeckArtifactEntry {
  const [first] = DECK.spells;
  if (first === undefined) throw new Error('the fixture has no spells');
  return { ...first, name, typeLine, count, criteria: [] };
}

function countOf(entries: readonly DeckArtifactEntry[]): number {
  return entries.reduce((sum, item) => sum + item.count, 0);
}

describe('counting a pane by type line', () => {
  it('partitions the cards, so the three numbers sum to the pane’s own count', () => {
    const entries = [
      entry('Ember Vanguard', 'Creature — Human Soldier', 4),
      entry('Sunlit Field', 'Basic Land — Plains', 9),
      entry('Rite of Cinders', 'Instant', 3),
    ];
    const counts = deckTypeCounts(entries);
    expect(counts).toEqual({ lands: 9, creatures: 4, other: 3 });
    expect(counts.lands + counts.creatures + counts.other).toBe(countOf(entries));
  });

  it('counts cards rather than entries, a four-of being four', () => {
    expect(deckTypeCounts([entry('Ember Vanguard', 'Creature — Human Soldier', 4)]).creatures).toBe(4);
  });

  it('counts a land that is also a creature as a land, the mana base being the question', () => {
    const both = deckTypeCounts([entry('Waking Grove', 'Land Creature — Forest Dryad', 1)]);
    expect(both).toEqual({ lands: 1, creatures: 0, other: 0 });
  });

  it('drops a card of a type nobody has printed yet into Other rather than nowhere', () => {
    // The bucket is defined as the complement, so this holds without the file
    // learning the type's name. A per-type list would lose the card silently.
    const counts = deckTypeCounts([entry('The Long Siege', 'Battle — Siege', 2)]);
    expect(counts).toEqual({ lands: 0, creatures: 0, other: 2 });
  });

  it('reads a subtype that merely contains a type word as the subtype it is', () => {
    // `Land` bounded by spaces, not `Land` anywhere in the string: a creature
    // whose subtype ends in the word would otherwise be counted as a land.
    expect(deckTypeCounts([entry('Hollow Scout', 'Creature — Landwalker Scout', 1)])).toEqual({
      lands: 0,
      creatures: 1,
      other: 0,
    });
  });

  it('leaves an empty bucket out of the line, a zero being a bucket that is not there', () => {
    expect(typeCountsLine({ lands: 24, creatures: 17, other: 19 })).toBe(
      'Lands: 24 · Creatures: 17 · Other: 19',
    );
    expect(typeCountsLine({ lands: 8, creatures: 0, other: 0 })).toBe('Lands: 8');
    expect(typeCountsLine({ lands: 0, creatures: 0, other: 0 })).toBe('');
  });
});

describe('the main deck as one pane', () => {
  const html = renderToStaticMarkup(h(DeckRoute, { state: { status: 'ready', deck: DECK } }));

  it('names itself with what it holds, the way the capture writes a pane title', () => {
    expect(html).toContain(`>${MAIN_DECK_LABEL}: ${String(DECK.totalCards)}<`);
  });

  it('holds the spells, the nonbasic lands and the basics, rather than a pane each', () => {
    expect(html).not.toContain('>Spells<');
    expect(html).not.toContain('>Nonbasic lands<');
    expect(html).not.toContain('>Basics<');
    const named = [...DECK.spells, ...DECK.lands, ...DECK.basics];
    for (const item of named) expect(html).toContain(item.name);
  });

  it('states the split in a line whose numbers sum to the number in its title', () => {
    const counts = deckTypeCounts([...DECK.spells, ...DECK.lands, ...DECK.basics]);
    expect(counts.lands).toBe(DECK.manaBase.totalLands);
    expect(counts.lands + counts.creatures + counts.other).toBe(DECK.totalCards);
    expect(html).toContain(typeCountsLine(counts));
  });

  it('keeps the pool the cards were chosen out of beside them', () => {
    expect(html).toContain('the criteria allow');
  });
});

describe('a deck that carries a sideboard', () => {
  const deck: DeckArtifact = {
    ...DECK,
    sideboard: [
      entry('Ember Vanguard', 'Creature — Human Soldier', 4),
      entry('Rite of Cinders', 'Instant', 3),
    ],
  };

  it('counts it in its own title and splits it in its own line', () => {
    const html = renderToStaticMarkup(h(DeckRoute, { state: { status: 'ready', deck } }));
    expect(html).toContain(`>${SIDEBOARD_LABEL}: 7<`);
    expect(html).toContain('Creatures: 4 · Other: 3');
  });

  it('gives each pane its own density, which is what the per-pane control is for', () => {
    render(h(DeckRoute, { state: { status: 'ready', deck } }));
    const side = screen.getByRole('group', { name: `${SIDEBOARD_LABEL}, View` });
    fireEvent.click(within(side).getByRole('button', { name: 'Compact list' }));
    expect(within(side).getByRole('button', { name: 'Compact list', pressed: true })).toBeTruthy();
    const main = screen.getByRole('group', { name: `${MAIN_DECK_LABEL}, View` });
    expect(within(main).getByRole('button', { name: 'Full cards', pressed: true })).toBeTruthy();
  });
});
