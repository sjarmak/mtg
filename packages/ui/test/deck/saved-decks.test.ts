// @vitest-environment jsdom
/**
 * Keeping a built deck: name it, save it, close the tab, open it again.
 *
 * The playtester asked for saving because there was none — the build lived in
 * `ConstructedGame`'s state and nothing wrote it anywhere. So the test that
 * matters is the one that survives the page going away, and this file runs it:
 * build, name, save, unmount everything, render the tab from scratch, and open
 * the deck out of the list. `cleanup()` throws the React tree away while
 * `localStorage` stays, which is what a reload is.
 *
 * The refusal is asserted as hard as the success. A saved deck naming cards the
 * staged set no longer prints comes back as a message that names them rather
 * than as a quietly shorter deck, and that path cannot be reached by clicking —
 * it needs a pool the set does not have — so it is asserted against
 * `restoreBuild` directly.
 *
 * No card name is written down: every subject is picked out of the committed
 * prototype set by shape, and the deck names typed here are prose.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { BUILD_LABEL, DeckRoute } from '../../src/routes/DeckRoute';
import { SEARCH_LABEL } from '../../src/routes/deck/ConstructedBuilder';
import { addCopy, emptyBuild, selectable, spellCount } from '../../src/routes/deck/build';
import {
  DECK_NAME_LABEL,
  EMPTY_LIST_NOTE,
  NO_OPEN_DECK_NOTE,
  SAVED_DECKS_TITLE,
  SAVED_NOTE,
  SAVE_CHANGES_LABEL,
  SAVE_NEW_LABEL,
  UNSAVED_NOTE,
} from '../../src/routes/deck/SavedDecksPanel';
import {
  deckFingerprint,
  nameTaken,
  newSavedDeckId,
  readSavedDecks,
  restoreBuild,
  savedCardCount,
  toSavedDeck,
  withSaved,
  withoutSaved,
  writeSavedDecks,
} from '../../src/routes/deck/saved-decks';

afterEach(cleanup);

/** One `localStorage` serves the whole file, so each test starts on a fresh browser. */
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

const FIRST_NAME = 'the list I keep coming back to';
const SECOND_NAME = 'the same list, renamed';

interface ElementLike {
  readonly nextElementSibling: { readonly textContent: string | null } | null;
  readonly hasAttribute: (name: string) => boolean;
}

function asElement(value: unknown): ElementLike {
  const candidate = value as Partial<ElementLike> | null | undefined;
  if (candidate === null || candidate === undefined || typeof candidate.hasAttribute !== 'function') {
    throw new Error('expected a rendered element');
  }
  return candidate as ElementLike;
}

/** The value beside a toolbar label: how the builder states a count on screen. */
function factValue(label: string): string {
  const value = asElement(screen.getByText(label)).nextElementSibling;
  if (value === null) throw new Error(`toolbar fact ${label} has no value`);
  return value.textContent ?? '';
}

/** What the saved-decks panel says about the deck on screen. */
function savedNote(): string {
  const note = asElement(screen.getByText(SAVED_DECKS_TITLE)).nextElementSibling;
  if (note === null) throw new Error('the saved-decks panel has no note');
  return note.textContent ?? '';
}

/** Opens the Decks tab and presses Build: what a person does before any of this. */
function openBuilder(): void {
  render(h(DeckRoute, { state: { status: 'absent' as const }, cards: SET }));
  fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
}

/** Plays `copies` of one pool card through the screen. */
function playCopies(card: Card, copies: number): void {
  fireEvent.change(screen.getByLabelText(SEARCH_LABEL), { target: { value: card.name } });
  const pool = screen.getByRole('group', { name: 'Playable cards' });
  const face = within(pool).getAllByRole('button', { name: new RegExp(card.name, 'u') })[0];
  if (face === undefined) throw new Error('the narrowed pool drew no face');
  for (let copy = 0; copy < copies; copy += 1) fireEvent.click(face);
}

function typeName(name: string): void {
  fireEvent.change(screen.getByLabelText(DECK_NAME_LABEL), { target: { value: name } });
}

describe('the saved deck as a document', () => {
  it('round-trips the cards and the mana base it was saved with', () => {
    let build = addCopy(addCopy(emptyBuild(SET), subject().id), subject().id);
    build = addCopy(build, subject(1).id);
    build = { ...build, basics: { U: 9, R: 8 } };
    const saved = toSavedDeck('deck-1', FIRST_NAME, build, '2026-08-20T00:00:00.000Z');
    expect(savedCardCount(saved)).toBe(3);

    const restored = restoreBuild(SET, saved);
    if (!restored.ok) throw new Error(restored.message);
    expect(spellCount(restored.build)).toBe(3);
    expect(restored.build.basics).toEqual({ U: 9, R: 8 });
    expect(deckFingerprint(restored.build)).toBe(deckFingerprint(build));
  });

  it('refuses to load against a set that no longer holds its cards, and names them', () => {
    const build = addCopy(emptyBuild(SET), subject().id);
    const saved = toSavedDeck('deck-1', FIRST_NAME, build, '2026-08-20T00:00:00.000Z');
    const thinner = SET.filter((card) => card.id !== subject().id);
    const restored = restoreBuild(thinner, saved);
    expect(restored.ok).toBe(false);
    if (restored.ok) throw new Error('a set without the card accepted the deck');
    expect(restored.message).toContain(subject().name);
    expect(restored.message).toContain('no longer holds');
  });

  it('is the cards and the base, not the name: renaming is not an unsaved change', () => {
    const build = addCopy(emptyBuild(SET), subject().id);
    const first = toSavedDeck('deck-1', FIRST_NAME, build, '2026-08-20T00:00:00.000Z');
    const renamed = toSavedDeck('deck-1', SECOND_NAME, build, '2026-08-20T00:00:01.000Z');
    expect(deckFingerprint(build)).toBe(deckFingerprint(build));
    expect(first.entries).toEqual(renamed.entries);
    expect(deckFingerprint(addCopy(build, subject().id))).not.toBe(deckFingerprint(build));
  });
});

describe('the list of saved decks in the store', () => {
  it('comes back newest first, and reads a store of nonsense as none', () => {
    const build = addCopy(emptyBuild(SET), subject().id);
    const older = toSavedDeck('deck-1', FIRST_NAME, build, '2026-08-19T00:00:00.000Z');
    const newer = toSavedDeck('deck-2', SECOND_NAME, build, '2026-08-20T00:00:00.000Z');
    expect(writeSavedDecks([older, newer])).toBe(true);
    expect(readSavedDecks().map((deck) => deck.id)).toEqual(['deck-2', 'deck-1']);

    const host = globalThis as { readonly localStorage?: { setItem?: (k: string, v: string) => void } };
    host.localStorage?.setItem?.('mtg.deck.saved', 'not json at all');
    expect(readSavedDecks()).toEqual([]);
  });

  it('replaces a deck in place by id and drops it by id', () => {
    const build = addCopy(emptyBuild(SET), subject().id);
    const first = toSavedDeck('deck-1', FIRST_NAME, build, '2026-08-19T00:00:00.000Z');
    const renamed = toSavedDeck('deck-1', SECOND_NAME, build, '2026-08-20T00:00:00.000Z');
    expect(withSaved([first], renamed)).toEqual([renamed]);
    expect(withSaved([], first)).toEqual([first]);
    expect(withoutSaved([first], 'deck-1')).toEqual([]);
    expect(nameTaken([first], FIRST_NAME, null)).toBe(true);
    expect(nameTaken([first], FIRST_NAME, 'deck-1')).toBe(false);
    expect(newSavedDeckId(0, 0)).not.toBe(newSavedDeckId(0, 0.5));
  });
});

describe('saving a deck from the builder', () => {
  it('will not save a deck with no name and no cards', () => {
    openBuilder();
    expect(asElement(screen.getByRole('button', { name: SAVE_NEW_LABEL })).hasAttribute('disabled')).toBe(
      true,
    );
    typeName(FIRST_NAME);
    expect(asElement(screen.getByRole('button', { name: SAVE_NEW_LABEL })).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByText(EMPTY_LIST_NOTE)).toBeTruthy();
    expect(savedNote()).toBe(NO_OPEN_DECK_NOTE);
  });

  it('keeps the deck across a reload, opens it again, renames it and deletes it', () => {
    openBuilder();
    playCopies(subject(), 2);
    typeName(FIRST_NAME);
    fireEvent.click(screen.getByRole('button', { name: SAVE_NEW_LABEL }));
    expect(savedNote()).toContain(SAVED_NOTE);
    expect(screen.getByRole('button', { name: `Open ${FIRST_NAME}` })).toBeTruthy();

    // One more copy and the panel says so, which is the whole point of saying it.
    playCopies(subject(), 1);
    expect(savedNote()).toContain(UNSAVED_NOTE);

    // The tab goes away. The store does not.
    cleanup();
    expect(readSavedDecks().map((deck) => deck.name)).toEqual([FIRST_NAME]);

    openBuilder();
    expect(factValue('spells').startsWith('0/')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: `Open ${FIRST_NAME}` }));
    expect(factValue('spells').startsWith('2/')).toBe(true);
    expect(savedNote()).toContain(SAVED_NOTE);

    typeName(SECOND_NAME);
    fireEvent.click(screen.getByRole('button', { name: SAVE_CHANGES_LABEL }));
    expect(readSavedDecks().map((deck) => deck.name)).toEqual([SECOND_NAME]);
    // One row, renamed, rather than a second row under the new name. Counted by
    // the per-row Open button rather than by every button in the group, so a row
    // gaining a control does not read as a deck appearing.
    expect(
      within(screen.getByRole('group', { name: SAVED_DECKS_TITLE })).getAllByRole('button', {
        name: /^Open /u,
      }).length,
    ).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: `Delete ${SECOND_NAME}` }));
    expect(readSavedDecks()).toEqual([]);
    expect(screen.getByText(EMPTY_LIST_NOTE)).toBeTruthy();
    expect(savedNote()).toBe(NO_OPEN_DECK_NOTE);
    // Deleting the deck did not empty the pane it came from.
    expect(factValue('spells').startsWith('2/')).toBe(true);
  });

  it('refuses a name another saved deck already uses', () => {
    openBuilder();
    playCopies(subject(), 1);
    typeName(FIRST_NAME);
    fireEvent.click(screen.getByRole('button', { name: SAVE_NEW_LABEL }));
    fireEvent.click(screen.getByRole('button', { name: SAVE_NEW_LABEL }));
    expect(readSavedDecks().length).toBe(1);
    expect(screen.getByText(new RegExp(`already called`, 'u'))).toBeTruthy();
  });
});
