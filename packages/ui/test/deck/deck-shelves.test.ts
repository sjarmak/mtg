// @vitest-environment jsdom
/**
 * One collection, shelved by set under the Custom/Magic taxonomy (`mtg-tewc.6`).
 *
 * The Decks tab used to sort its decks by who wrote them — a *Preconstructed*
 * grid over a *My decks* grid — and the playtester's instruction is that the shelf is
 * the set instead. Four claims are worth pinning, and each of them is a way the
 * wiring can be wrong while still typechecking.
 *
 * 1. **The heading is the label, never the value.** `official` is the field and
 *    *Magic* is what a person reads, which is a standing instruction rather than
 *    a preference; a heading that leaked the value would pass every other test
 *    in this directory.
 * 2. **An empty group is not drawn.** The same availability rule that makes Play
 *    draw no Decks section for a set that ships none.
 * 3. **A deck whose set nothing recorded is not filed under a guess.** The
 *    staged set is the tempting answer and it is a fabricated claim: a deck
 *    saved last month against another set would be shelved under whatever is
 *    staged this morning.
 * 4. **Saving records the set**, through the four components between the tab and
 *    the store — which is the seam that makes the shelving true tomorrow.
 *
 * No card name is written down: every subject is picked out of the committed
 * prototype set by shape. The set names typed here are invented, because this
 * tab knows nothing about any particular set and a test that borrowed a real
 * one would be asserting on that set instead.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { DECKS_UNPLACED_LABEL, BUILD_LABEL, DeckRoute, openDeckLabel } from '../../src/routes/DeckRoute';
import { shelveDecks } from '../../src/routes/deck/library';
import { SET_ORIGIN_LABELS } from '../../src/lab/set-origin';
import { addCopy, emptyBuild, selectable } from '../../src/routes/deck/build';
import { SEARCH_LABEL, addCopyLabel } from '../../src/routes/deck/ConstructedBuilder';
import { DECK_NAME_LABEL, SAVE_NEW_LABEL } from '../../src/routes/deck/SavedDecksPanel';
import { readSavedDecks, toSavedDeck, writeSavedDecks } from '../../src/routes/deck/saved-decks';
import type { SavedDeck, SavedDeckSet } from '../../src/routes/deck/saved-decks';

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

function subject(at = 0): Card {
  const card = selectable(SET)[at];
  if (card === undefined) throw new Error('the prototype set has no selectable card');
  return card;
}

const STAGED: SavedDeckSet = { name: 'The Tideglass Prototype', origin: 'custom' };
const A_PRINTED_SET: SavedDeckSet = { name: 'An Old Printing', origin: 'official' };

const HERE_NAME = 'the one I built this morning';
const ELSEWHERE_NAME = 'the one from the printed set';
const UNRECORDED_NAME = 'the one from before any of this';

/** A saved deck of one card, written straight to the store the tab reads. */
function store(...decks: readonly SavedDeck[]): void {
  writeSavedDecks(decks);
}

function savedOf(id: string, name: string, set?: SavedDeckSet): SavedDeck {
  const build = addCopy(emptyBuild(SET), subject().id);
  return toSavedDeck(id, name, build, `2026-08-2${String(id.length)}T00:00:00.000Z`, set);
}

function openLibrary(): void {
  render(h(DeckRoute, { state: { status: 'absent' as const }, cards: SET, set: STAGED }));
}

describe('shelving decks by set', () => {
  it('puts Custom before Magic and drops the group nothing is under', () => {
    const shelved = shelveDecks([
      { set: A_PRINTED_SET, key: 'a' },
      { set: STAGED, key: 'b' },
    ]);
    expect(shelved.groups.map((group) => group.label)).toEqual([
      SET_ORIGIN_LABELS.custom,
      SET_ORIGIN_LABELS.official,
    ]);
    expect(shelveDecks([{ set: STAGED, key: 'b' }]).groups.map((group) => group.label)).toEqual([
      SET_ORIGIN_LABELS.custom,
    ]);
  });

  it('keeps each set to one shelf, in the order its first deck arrived', () => {
    const shelved = shelveDecks([
      { set: STAGED, key: 'a' },
      { set: A_PRINTED_SET, key: 'b' },
      { set: STAGED, key: 'c' },
    ]);
    const sets = shelved.groups.flatMap((group) => group.rows);
    expect(sets.map((shelf) => shelf.setName)).toEqual([STAGED.name, A_PRINTED_SET.name]);
    expect(sets[0]?.rows.map((row) => row.key)).toEqual(['a', 'c']);
  });

  it('holds a deck that names no set aside rather than filing it under one', () => {
    const shelved = shelveDecks([
      { set: null, key: 'a' },
      { set: STAGED, key: 'b' },
    ]);
    expect(shelved.unplaced.map((row) => row.key)).toEqual(['a']);
    expect(shelved.groups.flatMap((group) => group.rows).flatMap((set) => set.rows)).toHaveLength(1);
  });
});

describe('the shelves on screen', () => {
  it('draws a deck from another set under that set, not under the staged one', () => {
    store(savedOf('here', HERE_NAME, STAGED), savedOf('elsewhere', ELSEWHERE_NAME, A_PRINTED_SET));
    openLibrary();
    const printed = within(screen.getByRole('group', { name: A_PRINTED_SET.name }));
    expect(printed.getByRole('button', { name: openDeckLabel(ELSEWHERE_NAME) })).toBeTruthy();
    const staged = within(screen.getByRole('group', { name: STAGED.name }));
    expect(staged.getByRole('button', { name: openDeckLabel(HERE_NAME) })).toBeTruthy();
    // The label a person reads, and never the value that decides it.
    expect(screen.getByRole('heading', { name: SET_ORIGIN_LABELS.official })).toBeTruthy();
    expect(screen.queryByText(/official/i)).toBeNull();
  });

  it('shelves a deck saved before the set was recorded under its own heading', () => {
    store(savedOf('legacy', UNRECORDED_NAME));
    openLibrary();
    const aside = within(screen.getByRole('group', { name: DECKS_UNPLACED_LABEL }));
    expect(aside.getByRole('button', { name: openDeckLabel(UNRECORDED_NAME) })).toBeTruthy();
  });
});

describe('what a save records', () => {
  /** Adds one copy of `card` through the pool pane, the way a person does. */
  function play(card: Card): void {
    fireEvent.change(screen.getByLabelText(SEARCH_LABEL), { target: { value: card.name } });
    const pool = screen.getByRole('group', { name: 'Playable cards' });
    // The `+` under the face: a click in the collection reads a card and a
    // double click plays one (`mtg-d0y1`).
    const step = within(pool).getAllByRole('button', { name: addCopyLabel(card.name) })[0];
    if (step === undefined) throw new Error('the narrowed pool drew no face');
    fireEvent.click(step);
  }

  function saveAs(name: string): void {
    fireEvent.change(screen.getByLabelText(DECK_NAME_LABEL), { target: { value: name } });
    fireEvent.click(screen.getByRole('button', { name: SAVE_NEW_LABEL }));
  }

  it('writes the staged set onto the deck, through every component between', () => {
    openLibrary();
    fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
    play(subject());
    saveAs(HERE_NAME);
    expect(readSavedDecks()[0]?.set).toEqual(STAGED);
  });

  /**
   * `mtg-6nqs`. The Constructed pool is the union of every staged set, so the
   * deck on screen can be entirely somebody else's set while the header names
   * this one. The set on the document is therefore read off the cards that were
   * chosen, and the header's name is not an answer to that question — writing it
   * anyway would shelve a Magic 2011 deck under the flagship for no reason but
   * which tab was open.
   */
  describe('for a deck built out of a pool spanning two sets', () => {
    const playable = selectable(SET);
    const cut = Math.floor(playable.length / 2);
    const HERE = playable.slice(0, cut);
    const ELSEWHERE = playable.slice(cut);

    function openAcross(): void {
      render(
        h(DeckRoute, {
          state: { status: 'absent' as const },
          cards: HERE,
          set: STAGED,
          poolSets: [
            { name: STAGED.name, cards: HERE, origin: STAGED.origin },
            { name: A_PRINTED_SET.name, cards: ELSEWHERE, origin: A_PRINTED_SET.origin },
          ],
        }),
      );
      fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
    }

    function first(of: readonly Card[]): Card {
      const card = of[0];
      if (card === undefined) throw new Error('the half is empty');
      return card;
    }

    it('records the set the cards came from, not the one the header names', () => {
      openAcross();
      play(first(ELSEWHERE));
      saveAs(ELSEWHERE_NAME);
      expect(readSavedDecks()[0]?.set).toEqual(A_PRINTED_SET);
    });

    it('still records the header’s set when that is where the cards came from', () => {
      openAcross();
      play(first(HERE));
      saveAs(HERE_NAME);
      expect(readSavedDecks()[0]?.set).toEqual(STAGED);
    });

    it('records no set at all for a deck cut from both', () => {
      openAcross();
      play(first(HERE));
      play(first(ELSEWHERE));
      saveAs(HERE_NAME);
      const saved = readSavedDecks()[0];
      expect(saved?.entries).toHaveLength(2);
      expect(saved?.set).toBeUndefined();
    });
  });
});
