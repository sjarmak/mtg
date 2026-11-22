// @vitest-environment jsdom
/**
 * The deck as a decklist, which is what the deck pane opens in (`mtg-umro`).
 *
 * The bead is a layout decision and this is the half of it that is behavior: a
 * row per distinct card with its copies on it, grouped and counted the way the
 * columns were, both moves on the row, and the two accelerators the strips
 * already carried. What the arrangement does to the workbench is measured in
 * `./builder-workbench.browser.test.ts`.
 *
 * No card name is written down: every subject is picked out of the committed
 * prototype set by shape, so this file stays a public document.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { CONSTRUCTED_COPY_LIMIT } from '@mtg/deckbuild';
import {
  ConstructedBuilder,
  DECK_CARDS_LABEL,
  DECK_LABEL,
  addCopyLabel,
  cutCopyLabel,
} from '../../src/routes/deck/ConstructedBuilder';
import { deckRowLabel } from '../../src/routes/deck/DeckListRows';
import { DECK_VIEW_LABEL, DECK_VIEW_LABELS, readDeckViewMode } from '../../src/routes/deck/view-mode';
import { PANE_DECKLIST_VIEWS } from '../../src/routes/deck/DeckPane';
import { addCopy, deckFor, emptyBuild, selectable } from '../../src/routes/deck/build';
import type { ConstructedBuild } from '../../src/routes/deck/build';

afterEach(cleanup);
afterEach((): void => {
  const host = globalThis as { readonly localStorage?: { clear?: () => void } };
  host.localStorage?.clear?.();
});

const SET_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'setgen',
  'fixtures',
  'sets',
  'tideglass-reach.set.json',
);

function loadSet(): readonly Card[] {
  const raw: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));
  const { cards } = raw as { cards: unknown[] };
  return cards.map((card) => parseCard(card));
}

const SET = loadSet();

/** The workspace tsconfig has no `lib: dom`, so these members are reached by hand. */
interface Readable {
  readonly textContent: string | null;
  readonly getAttribute: (name: string) => string | null;
  readonly disabled: boolean;
}

function readable(value: unknown): Readable {
  return value as Readable;
}

function subject(at = 0): Card {
  const card = selectable(SET)[at];
  if (card === undefined) throw new Error('the prototype set has no selectable card');
  return card;
}

interface Moves {
  readonly added: string[];
  readonly cut: string[];
}

function builderWith(build: ConstructedBuild): Moves {
  const moves: Moves = { added: [], cut: [] };
  render(
    h(ConstructedBuilder, {
      build,
      deck: deckFor(build),
      onAdd: (id: string) => moves.added.push(id),
      onCut: (id: string) => moves.cut.push(id),
      onClear: () => undefined,
      onAdjustBasics: () => undefined,
      onSuggestBasics: () => undefined,
      onLoad: () => undefined,
      onPlay: () => undefined,
    }),
  );
  return moves;
}

/** A build playing `copies` of the card at `at`, assembled through the state module. */
function playing(copies: number, at = 0): ConstructedBuild {
  let build = emptyBuild(SET);
  for (let copy = 0; copy < copies; copy += 1) build = addCopy(build, subject(at).id);
  return build;
}

function deckList(): ReturnType<typeof screen.getByRole> {
  return screen.getByRole('group', { name: DECK_CARDS_LABEL });
}

describe('the deck pane on arrival', () => {
  it('is the decklist, before anybody has chosen a drawing', () => {
    expect(
      readDeckViewMode('constructed-deck', PANE_DECKLIST_VIEWS.offered, PANE_DECKLIST_VIEWS.fallback),
    ).toBe('list');
  });

  /**
   * Two drawings on the deck's control, three in the file. Offering `compact`
   * beside `list` would be offering two answers to "the deck, small", one of
   * which needs a width this pane does not have.
   */
  it('offers the decklist and whole cards, and nothing else', () => {
    builderWith(playing(2));
    const control = screen.getByRole('group', { name: `${DECK_LABEL}, ${DECK_VIEW_LABEL}` });
    expect(
      within(control)
        .getAllByRole('button')
        .map((node) => readable(node).textContent),
    ).toEqual([DECK_VIEW_LABELS.list, DECK_VIEW_LABELS.full]);
  });
});

describe('a row of the decklist', () => {
  it('names the card and how many copies are played', () => {
    builderWith(playing(CONSTRUCTED_COPY_LIMIT));
    expect(
      within(deckList()).getByRole('button', {
        name: deckRowLabel(subject(), CONSTRUCTED_COPY_LIMIT),
      }),
    ).toBeTruthy();
  });

  it('draws one row per distinct card, not one per copy', () => {
    builderWith(playing(CONSTRUCTED_COPY_LIMIT));
    // The strips draw a copy each, which is what the count above a column
    // counts; a list draws the card and writes the count on it.
    expect(within(deckList()).getAllByRole('button', { name: /^\d+ / }).length).toBe(1);
  });

  it('carries both moves, so neither needs a right click or a bar', () => {
    const moves = builderWith(playing(2));
    const list = deckList();
    fireEvent.click(within(list).getByRole('button', { name: addCopyLabel(subject().name) }));
    fireEvent.click(within(list).getByRole('button', { name: cutCopyLabel(subject().name) }));
    expect(moves.added).toEqual([subject().id]);
    expect(moves.cut).toEqual([subject().id]);
  });

  it('darkens the step that is not a move', () => {
    builderWith(playing(CONSTRUCTED_COPY_LIMIT));
    const list = deckList();
    const add = within(list).getByRole('button', { name: addCopyLabel(subject().name) });
    expect(readable(add).disabled).toBe(true);
  });

  it('selects on a click rather than acting, which is the strips’ grammar', () => {
    const moves = builderWith(playing(2));
    const row = within(deckList()).getByRole('button', { name: deckRowLabel(subject(), 2) });
    fireEvent.click(row);
    expect(moves.added).toEqual([]);
    expect(moves.cut).toEqual([]);
    expect(
      (row as unknown as { getAttribute: (name: string) => string | null }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('cuts a copy on a double click and plays one on a right click', () => {
    const moves = builderWith(playing(2));
    const row = within(deckList()).getByRole('button', { name: deckRowLabel(subject(), 2) });
    fireEvent.doubleClick(row);
    fireEvent.contextMenu(row);
    expect(moves.cut).toEqual([subject().id]);
    expect(moves.added).toEqual([subject().id]);
  });

  /**
   * A press on a step is one move, not two. The row is a button and the steps
   * sit inside it, so without the stop the same press would also select the row
   * underneath it and the reader would see a card light up they never chose.
   */
  it('does not also select the row when a step is pressed', () => {
    builderWith(playing(2));
    const list = deckList();
    fireEvent.click(within(list).getByRole('button', { name: addCopyLabel(subject().name) }));
    const row = within(list).getByRole('button', { name: deckRowLabel(subject(), 2) });
    expect(
      (row as unknown as { getAttribute: (name: string) => string | null }).getAttribute('aria-pressed'),
    ).toBe('false');
  });
});
