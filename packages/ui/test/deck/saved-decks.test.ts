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
import { SEARCH_LABEL, addCopyLabel } from '../../src/routes/deck/ConstructedBuilder';
import { addCopy, deckFor, emptyBuild, selectable, spellCount } from '../../src/routes/deck/build';
import type { ConstructedBuild } from '../../src/routes/deck/build';
import { constructedPool, withMintedBasics } from '../../src/routes/deck/constructed-pool';
import type { PoolSet } from '../../src/routes/deck/constructed-pool';
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
  savedBasics,
  savedCardCount,
  savedDeckDocument,
  toSavedDeck,
  withSaved,
  withoutSaved,
  writeSavedDecks,
} from '../../src/routes/deck/saved-decks';
import type { SavedDeck, SavedDeckBasic } from '../../src/routes/deck/saved-decks';

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

/** A fixed timestamp: a saved deck records when it was written and nothing here reads it. */
const NOW = '2026-01-01T00:00:00.000Z';
const SECOND_NAME = 'the same list, renamed';

interface ElementLike {
  readonly nextElementSibling: { readonly textContent: string | null } | null;
  readonly hasAttribute: (name: string) => boolean;
  readonly closest: (selector: string) => unknown;
}

function asElement(value: unknown): ElementLike {
  const candidate = value as Partial<ElementLike> | null | undefined;
  if (candidate === null || candidate === undefined || typeof candidate.hasAttribute !== 'function') {
    throw new Error('expected a rendered element');
  }
  return candidate as ElementLike;
}

/**
 * How many cards have been picked, read off the toolbar's own sentence.
 *
 * It used to read a `spells 4/36` fact pair, which `mtg-dcxg.7` took off the
 * screen: the strip counted the assembled deck and the deck pane counted the
 * picks, and the two disagreed in front of the reader. The toolbar now prints
 * one prose line and the deck pane prints the same one, so this parses the two
 * numbers that are the picks.
 */
function pickedCards(): number {
  // The toolbar and the deck pane print the identical sentence, which is the
  // point of it; either copy answers this.
  const [first] = screen.getAllByText(/ of \d+ cards ·/);
  const line = (first as unknown as { textContent: string | null } | undefined)?.textContent ?? null;
  if (line === null) throw new Error('the builder states no counts');
  const creatures = /(\d+) creatures?(?: |$)/.exec(line);
  const spells = /(\d+) noncreature spells?(?: |$)/.exec(line);
  if (creatures?.[1] === undefined || spells?.[1] === undefined) {
    throw new Error(`the builder's count line is not two piles: ${line}`);
  }
  return Number(creatures[1]) + Number(spells[1]);
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
  // The `+` under the face, not the face: a click in the collection reads a
  // card and a double click plays one (`mtg-d0y1`).
  const step = within(pool).getAllByRole('button', { name: addCopyLabel(card.name) })[0];
  if (step === undefined) throw new Error('the narrowed pool drew no face');
  for (let copy = 0; copy < copies; copy += 1) fireEvent.click(step);
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
    expect(pickedCards()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: `Open ${FIRST_NAME}` }));
    expect(pickedCards()).toBe(2);
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
    expect(pickedCards()).toBe(2);
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

/**
 * The panel is a disclosure and the summary is what a shut one costs.
 *
 * Two things are asserted rather than one: that it opens shut on an arrival with
 * nothing to keep and nothing kept, and that the message line is *outside* it.
 * The second is the load-bearing half — a private window refuses to store the
 * deck, and a warning a shut panel can swallow is a warning nobody reads.
 */
describe('the save controls as a disclosure', () => {
  const disclosure = (): ElementLike =>
    asElement(asElement(screen.getByText(SAVED_DECKS_TITLE)).closest('details'));

  it('opens shut on a browser with nothing saved and a deck with no cards', () => {
    openBuilder();
    expect(disclosure().hasAttribute('open')).toBe(false);
    // The state note is in the summary, so the shut panel still says it.
    expect(savedNote()).toBe(NO_OPEN_DECK_NOTE);
  });

  it('opens on a browser that already holds a deck', () => {
    writeSavedDecks([toSavedDeck('kept', FIRST_NAME, addCopy(emptyBuild(SET), subject().id), NOW)]);
    openBuilder();
    expect(disclosure().hasAttribute('open')).toBe(true);
  });

  it('keeps a refusal outside the disclosure, where a shut panel cannot hide it', () => {
    writeSavedDecks([toSavedDeck('gone', FIRST_NAME, addCopy(emptyBuild(SET), subject().id), NOW)]);
    openBuilder();
    // Deleting the only saved deck leaves the list empty and the panel open;
    // what matters is where the note that a press produces is drawn.
    fireEvent.click(screen.getByRole('button', { name: `Delete ${FIRST_NAME}` }));
    typeName(FIRST_NAME);
    playCopies(subject(), 1);
    fireEvent.click(screen.getByRole('button', { name: SAVE_NEW_LABEL }));
    fireEvent.click(screen.getByRole('button', { name: SAVE_NEW_LABEL }));
    const message = asElement(screen.getByText(/already called/u));
    expect(message.closest('details')).toBeNull();
  });
});

/**
 * Which Plains a reopened deck is dealt (`mtg-t7ez`).
 *
 * The pool a saved deck is reopened against is the union of every staged set,
 * and a color plus a count cannot say which set's Plains it meant, so the union's
 * order answered it: the first staged set's, whatever set the deck was cut from.
 * The lands on the board then drew the labeled pending frame, because the deck's
 * own art manifest has no key for the other set's basic.
 *
 * Two staged sets are the whole apparatus, and the first one is deliberately the
 * one the deck is *not* cut from: an assertion against a one-set pool passes
 * without the resolver, because there is only one Plains to find.
 */
const UNION_SETS: readonly PoolSet[] = withMintedBasics([
  { name: 'First Set', origin: 'custom', cards: [unionCard('AAA', 'aaa-1', 'First Bear')] },
  { name: 'Second Set', origin: 'custom', cards: [unionCard('BBB', 'bbb-1', 'Second Bear')] },
]);

const UNION = constructedPool(UNION_SETS);

/** The set the deck below was cut from, as the document records it. */
const SECOND_SET_REF = { name: 'Second Set', origin: 'custom' } as const;

/** A mono-white creature, so the mana base the deck gets is Plains. */
function unionCard(setCode: string, id: string, name: string): Card {
  return parseCard({
    id,
    name,
    rarity: 'common',
    set: { code: setCode, collectorNumber: 1 },
    colors: ['W'],
    supertypes: [],
    subtypes: ['Bear'],
    keywords: [],
    effects: [],
    abilities: [],
    power: 2,
    toughness: 2,
    kind: 'creature',
    manaCost: { generic: 1, W: 1, U: 0, B: 0, R: 0, G: 0 },
    artifact: false,
    oracleText: '',
  });
}

/** The ids of the basics the reopened deck actually plays. */
function landIds(build: ConstructedBuild): readonly string[] {
  return deckFor(build).lands.map((land) => land.id);
}

/** A deck of Second Set cards, saved with `set` recorded and `basics` as given. */
function savedFromSecondSet(basics: readonly SavedDeckBasic[] | null, withSet = true): SavedDeck {
  return savedDeckDocument({
    id: 'deck-1',
    name: FIRST_NAME,
    savedAt: NOW,
    entries: [{ id: 'bbb-1', name: 'Second Bear', count: 4 }],
    basics,
    ...(withSet ? { set: SECOND_SET_REF } : {}),
  });
}

describe('which printing a reopened deck plays its basics from', () => {
  it('records the printing beside the count when the build knows one', () => {
    const second = UNION.cards.find((card) => card.id === 'bbb-plains');
    if (second === undefined) throw new Error('the union minted no Second Set Plains');
    const build: ConstructedBuild = {
      ...addCopy(emptyBuild(UNION.cards), 'bbb-1'),
      basics: { W: 9 },
      set: [second],
    };
    expect(savedBasics(build)).toEqual([{ color: 'W', count: 9, id: 'bbb-plains' }]);
  });

  it('writes no printing for a build assembled by clicking, rather than the union’s guess', () => {
    const build: ConstructedBuild = { ...addCopy(emptyBuild(UNION.cards), 'bbb-1'), basics: { W: 9 } };
    expect(savedBasics(build)).toEqual([{ color: 'W', count: 9 }]);
  });

  it('reopens on the printing the deck recorded', () => {
    const saved = savedFromSecondSet([{ color: 'W', count: 9, id: 'bbb-plains' }]);
    const restored = restoreBuild(UNION.cards, saved);
    if (!restored.ok) throw new Error(restored.message);
    expect(landIds(restored.build)).toContain('bbb-plains');
    expect(landIds(restored.build)).not.toContain('aaa-plains');
  });

  it('resolves a deck saved before the printing was recorded through the set it names', () => {
    // Exactly the document shape every browser already holds: a color, a count
    // and no id, beside the set the library shelves the deck under.
    const saved = savedFromSecondSet([{ color: 'W', count: 9 }]);
    const restored = restoreBuild(UNION.cards, saved, { setOf: UNION.setOf });
    if (!restored.ok) throw new Error(restored.message);
    expect(landIds(restored.build)).toContain('bbb-plains');
    expect(landIds(restored.build)).not.toContain('aaa-plains');
  });

  it('deals the recorded set’s basics to a deck that never overrode the computed base', () => {
    const saved = savedFromSecondSet(null);
    const restored = restoreBuild(UNION.cards, saved, { setOf: UNION.setOf });
    if (!restored.ok) throw new Error(restored.message);
    expect(restored.build.basics).toBeNull();
    expect(landIds(restored.build)).toContain('bbb-plains');
    expect(landIds(restored.build)).not.toContain('aaa-plains');
  });

  it('leaves a deck that records neither to the union’s order rather than guessing', () => {
    const saved = savedFromSecondSet([{ color: 'W', count: 9 }], false);
    const restored = restoreBuild(UNION.cards, saved, { setOf: UNION.setOf });
    if (!restored.ok) throw new Error(restored.message);
    expect(restored.build.set).toBeNull();
    expect(landIds(restored.build)).toContain('aaa-plains');
  });

  it('still opens a deck whose caller cannot say which set a pool card came from', () => {
    // `DeckFilePanel` restores a deck parsed out of a text list and has no such
    // map; the deck opens, and its printing is simply not known.
    const saved = savedFromSecondSet([{ color: 'W', count: 9 }]);
    const restored = restoreBuild(UNION.cards, saved);
    if (!restored.ok) throw new Error(restored.message);
    expect(restored.build.set).toBeNull();
    expect(spellCount(restored.build)).toBe(4);
  });
});
