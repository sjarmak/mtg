// @vitest-environment jsdom
/**
 * The Constructed builder on screen: the entry to it, the search that makes a
 * 250-card pool navigable, and the rule that keeps the play button dark.
 *
 * The acceptance this covers is a sequence, so the tests run it: open the Decks
 * tab, press Build, narrow the pool to one card, play four copies of it, and
 * watch the deck pane count them. Sixty cards by clicking is not a test anybody
 * should read, so the legality gate is asserted over a build assembled through
 * the state module and handed to the screen — which is the same build the
 * clicks produce, one gesture at a time.
 *
 * The curve is here too, because the question it answers — how many two-drops
 * does this deck play — is a question about the screen and not about a function.
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
import { CONSTRUCTED_COPY_LIMIT, CONSTRUCTED_DECK_SIZE } from '@mtg/deckbuild';
import { BUILD_LABEL, DeckRoute } from '../../src/routes/DeckRoute';
import {
  ConstructedBuilder,
  CLEAR_FILTER_LABEL,
  CONSTRUCTED_POOL_LABEL,
  DECK_CARDS_LABEL,
  DECK_LABEL,
  EMPTY_DECK_NOTE,
  MANA_CURVE_LABEL,
  matchNote,
  MIRROR_NOTE,
  PLAY_LABEL,
  SEARCH_LABEL,
  addCopyLabel,
  cutCopyLabel,
  emptySearchNote,
} from '../../src/routes/deck/ConstructedBuilder';
import { curveLabel } from '../../src/routes/deck/columns';
import { GROUPINGS, groupingLabel } from '../../src/routes/deck/grouping';
import { GROUPING_LABEL } from '../../src/routes/deck/GroupingControl';
import { addCopy, cardManaValue, deckFor, emptyBuild, selectable } from '../../src/routes/deck/build';
import type { ConstructedBuild } from '../../src/routes/deck/build';

afterEach(cleanup);

/**
 * jsdom keeps one `localStorage` for the whole file, and both a pane's density
 * and the saved-deck list live there. A pane switched to compact in one test
 * would still be compact in the next, which is a test reading another test's
 * state rather than the screen's.
 */
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

/** The Decks tab with a staged set and nothing else: the builder's own state. */
function openDeckTab(): void {
  render(h(DeckRoute, { state: { status: 'absent' as const }, cards: SET }));
}

function builderWith(
  build: ConstructedBuild,
  starters: readonly Starter[] = [],
  extra: Record<string, unknown> = {},
): void {
  render(
    h(ConstructedBuilder, {
      build,
      deck: deckFor(build),
      onAdd: () => undefined,
      onCut: () => undefined,
      onClear: () => undefined,
      onAdjustBasics: () => undefined,
      onSuggestBasics: () => undefined,
      onLoad: () => undefined,
      onPlay: () => undefined,
      starters,
      onStart: () => undefined,
      ...extra,
    }),
  );
}

interface Starter {
  readonly id: string;
  readonly name: string;
}

const STARTERS: readonly Starter[] = [{ id: 'written-a', name: 'A written deck' }];

/**
 * Narrows what testing-library hands back to the members these assertions use.
 * The workspace tsconfig has no `lib: dom`, so `HTMLElement` carries none of
 * them and the check has to happen at runtime, as `../play/sealed.test.ts` does
 * for the same reason.
 */
interface ElementLike {
  readonly nextElementSibling: { readonly textContent: string | null } | null;
  readonly hasAttribute: (name: string) => boolean;
  readonly getAttribute: (name: string) => string | null;
  readonly querySelectorAll: (selector: string) => { readonly length: number };
  /** The workspace has no `lib: dom`, so an ancestor is reached through this. */
  readonly closest: (selector: string) => ElementLike | null;
  readonly textContent: string | null;
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

/** True when a control is on screen and refusing to be pressed. */
function isDisabled(name: string): boolean {
  return asElement(screen.getByRole('button', { name })).hasAttribute('disabled');
}

describe('the entry to the builder', () => {
  it('is on the Decks tab whenever a set is staged, with no deck and no precons', () => {
    openDeckTab();
    expect(screen.getByRole('button', { name: BUILD_LABEL })).toBeTruthy();
  });

  it('opens a builder over every playable card', () => {
    openDeckTab();
    fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
    expect(screen.getByLabelText(SEARCH_LABEL)).toBeTruthy();
    expect(factValue('showing')).toBe(`${String(selectable(SET).length)}/${String(selectable(SET).length)}`);
  });
});

describe('narrowing the pool', () => {
  it('narrows to the cards whose name, type or rules text holds what was typed', () => {
    openDeckTab();
    fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
    fireEvent.change(screen.getByLabelText(SEARCH_LABEL), { target: { value: subject().name } });
    const [count] = factValue('showing').split('/');
    expect(Number(count)).toBeGreaterThan(0);
    expect(Number(count)).toBeLessThan(selectable(SET).length);
  });

  it('gives the whole pool back, and says so by going dark when it already has', () => {
    openDeckTab();
    fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
    expect(isDisabled(CLEAR_FILTER_LABEL)).toBe(true);
    fireEvent.change(screen.getByLabelText(SEARCH_LABEL), { target: { value: subject().name } });
    expect(isDisabled(CLEAR_FILTER_LABEL)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: CLEAR_FILTER_LABEL }));
    expect(factValue('showing')).toBe(`${String(selectable(SET).length)}/${String(selectable(SET).length)}`);
  });
});

describe('the two moves, as controls rather than as gestures', () => {
  /**
   * A right click has no keyboard equivalent and no touch equivalent, so the
   * screen that told a person to right click told some of them nothing. The
   * gestures still work; these are the same two moves with names, and they go
   * dark at the ends of the range rather than doing nothing when pressed.
   */
  it('plays and cuts a copy from a named button, up to the fourth and no further', () => {
    openDeckTab();
    fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
    const card = subject();
    fireEvent.change(screen.getByLabelText(SEARCH_LABEL), { target: { value: card.name } });
    const pool = screen.getByRole('group', { name: CONSTRUCTED_POOL_LABEL });
    const add = within(pool).getByRole('button', { name: addCopyLabel(card.name) });
    const cut = within(pool).getByRole('button', { name: cutCopyLabel(card.name) });

    expect(asElement(cut).hasAttribute('disabled')).toBe(true);
    for (let played = 0; played < CONSTRUCTED_COPY_LIMIT; played += 1) fireEvent.click(add);
    expect(pickedCards()).toBe(CONSTRUCTED_COPY_LIMIT);
    expect(asElement(add).hasAttribute('disabled')).toBe(true);
    expect(asElement(cut).hasAttribute('disabled')).toBe(false);

    fireEvent.click(cut);
    expect(pickedCards()).toBe(CONSTRUCTED_COPY_LIMIT - 1);
    expect(asElement(add).hasAttribute('disabled')).toBe(false);
  });

  it('draws the deck and the pool as two panes of one workspace', () => {
    openDeckTab();
    fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
    expect(screen.getByRole('region', { name: DECK_LABEL })).toBeTruthy();
    expect(screen.getByRole('region', { name: CONSTRUCTED_POOL_LABEL })).toBeTruthy();
  });
});

/**
 * Plays `copies` of a card from the collection, by its `+` control.
 *
 * The gesture that plays a card from the collection is a double click since
 * `mtg-d0y1`, and it is asserted once, below. Everything else that needs cards
 * in the deck steers by the named control, which is what a person who cannot
 * double click uses anyway.
 */
function playFromPool(card: Card, copies = 1): void {
  fireEvent.change(screen.getByLabelText(SEARCH_LABEL), { target: { value: card.name } });
  const pool = screen.getByRole('group', { name: CONSTRUCTED_POOL_LABEL });
  const step = within(pool).getAllByRole('button', { name: addCopyLabel(card.name) })[0];
  if (step === undefined) throw new Error('the narrowed pool drew no face');
  for (let copy = 0; copy < copies; copy += 1) fireEvent.click(step);
}

/** The deck pane in its card view, which is where a copy is what is selected. */
function showDeckCards(): void {
  fireEvent.click(
    within(screen.getByRole('group', { name: `${DECK_LABEL}, View` })).getByRole('button', {
      name: 'Full cards',
    }),
  );
}

describe('playing copies of a card', () => {
  /**
   * The 2026-08-29 grammar, end to end: the pool still acts on a click, and the
   * deck pane now selects a *copy* and acts from the bar that names the move.
   *
   * The middle assertion is the one worth having. A click in the deck pane used
   * to cut, and the whole point of `mtg-pmpu.1` is that it no longer does —
   * a strip is 26 pixels tall and a mis-click that silently removed a card from
   * a deck is the failure the selection step exists to prevent.
   */
  it('counts them up from the pool, and cuts from the bar the selected copy names', () => {
    openDeckTab();
    fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
    const card = subject();
    playFromPool(card, 2);
    expect(screen.getAllByText('2 in deck').length).toBeGreaterThan(0);
    expect(pickedCards()).toBe(2);

    // The card view, which is where a *copy* is the thing under the outline: the
    // pane opens on the decklist since `mtg-umro`, and a row carries its own two
    // moves rather than feeding the bar (`../../src/routes/deck/DeckListRows.ts`).
    showDeckCards();
    const deck = screen.getByRole('group', { name: DECK_CARDS_LABEL });
    const copy = within(deck).getAllByRole('button', { name: new RegExp(card.name, 'u') })[0];
    if (copy === undefined) throw new Error('the deck pane drew no strip');
    fireEvent.click(copy);
    expect(pickedCards()).toBe(2);
    expect(asElement(copy).getAttribute('aria-pressed')).toBe('true');

    const bar = screen.getByRole('group', { name: new RegExp(`^Selected: ${card.name}`, 'u') });
    fireEvent.click(within(bar).getByRole('button', { name: cutCopyLabel(card.name) }));
    expect(pickedCards()).toBe(1);

    fireEvent.click(within(bar).getByRole('button', { name: addCopyLabel(card.name) }));
    expect(pickedCards()).toBe(2);
  });

  /**
   * The accelerator reaches this screen's own move.
   *
   * Fired the way a browser fires one — `click`, `click`, `dblclick` — because
   * that is the sequence the strip is guarded against, and a bare `dblclick`
   * would pass whether or not the guard were there. What the guard itself
   * promises is one `onSelect` per gesture, which is invisible from here and is
   * counted in `./strip-columns.test.ts`.
   */
  it('cuts one copy on a double click', () => {
    openDeckTab();
    fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
    const card = subject();
    playFromPool(card, 2);
    showDeckCards();
    const deck = screen.getByRole('group', { name: DECK_CARDS_LABEL });
    const copy = within(deck).getAllByRole('button', { name: new RegExp(card.name, 'u') })[0];
    if (copy === undefined) throw new Error('the deck pane drew no strip');
    fireEvent.click(copy, { detail: 1 });
    fireEvent.click(copy, { detail: 2 });
    fireEvent.doubleClick(copy);
    expect(pickedCards()).toBe(1);
  });

  /** The reverse gesture, which is the pool's move played from the deck pane. */
  it('plays another copy on a right click, without leaving the deck pane', () => {
    openDeckTab();
    fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
    const card = subject();
    playFromPool(card);
    showDeckCards();
    const deck = screen.getByRole('group', { name: DECK_CARDS_LABEL });
    const copy = within(deck).getAllByRole('button', { name: new RegExp(card.name, 'u') })[0];
    if (copy === undefined) throw new Error('the deck pane drew no strip');
    fireEvent.contextMenu(copy);
    expect(pickedCards()).toBe(2);
  });

  /**
   * The collection's own grammar, which `mtg-d0y1` reversed.
   *
   * It was a click to play a copy and a right click to cut one: fast, and one
   * mis-aimed press away from a card in the deck nobody chose. the playtester asked
   * for MTGO's: "Double-click card in collection to add one copy." So a click
   * reads the card -- it outlines it and the floating preview draws its whole
   * face -- and the double click is the move.
   *
   * Fired the way a browser fires one, `click`, `click`, `dblclick`, for the
   * reason the deck pane's own accelerator test gives.
   */
  it('reads a card on a click in the collection and plays one on a double click', () => {
    openDeckTab();
    fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
    const card = subject();
    fireEvent.change(screen.getByLabelText(SEARCH_LABEL), { target: { value: card.name } });
    const pool = screen.getByRole('group', { name: CONSTRUCTED_POOL_LABEL });
    const face = within(pool).getAllByRole('button', { name: new RegExp(card.name, 'u') })[0];
    if (face === undefined) throw new Error('the narrowed pool drew no face');

    fireEvent.click(face);
    expect(pickedCards(), 'a click in the collection played a card').toBe(0);
    expect(asElement(face).closest('.mtg-copies')?.getAttribute('data-picked')).toBe('true');

    fireEvent.click(face, { detail: 1 });
    fireEvent.click(face, { detail: 2 });
    fireEvent.doubleClick(face);
    expect(pickedCards()).toBe(1);
  });

  /** The reverse, unchanged: a right click in the collection cuts a copy. */
  it('cuts a copy on a right click in the collection', () => {
    openDeckTab();
    fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
    const card = subject();
    playFromPool(card, 2);
    const pool = screen.getByRole('group', { name: CONSTRUCTED_POOL_LABEL });
    const face = within(pool).getAllByRole('button', { name: new RegExp(card.name, 'u') })[0];
    if (face === undefined) throw new Error('the narrowed pool drew no face');
    fireEvent.contextMenu(face);
    expect(pickedCards()).toBe(1);
  });
});

/**
 * The curve of the deck being built, which is the half of `mtg-g77d` that was
 * partly there already.
 *
 * Three separate things were wrong and each is asserted on its own, because
 * fixing any two of them still leaves the question unanswered. The number above
 * a column counted *tiles*, so a playset drawn as one face with a 4x on it
 * counted once and a sixty-card deck read 13 — `../lab/deck-columns.test.ts`
 * pins the same rule for a built artifact and `../../src/routes/deck/columns.ts` argues it. The
 * columns existed only in the compact pane while full was the density a pane
 * opened in, so the answer was two presses away; `mtg-ljda` made compact the
 * default and `mtg-rgc.21` gave full the same columns, and the describe below it
 * reads that. And the pool pane drew columns too, which is a different question
 * from the one that was asked.
 */
describe('the curve of the deck being built', () => {
  /** Plays `copies` of one pool card through the screen, as a person would. */
  function playCopies(card: Card, copies: number): void {
    fireEvent.change(screen.getByLabelText(SEARCH_LABEL), { target: { value: card.name } });
    const pool = screen.getByRole('group', { name: 'Playable cards' });
    // The `+` under the face rather than the face itself. A click in the
    // collection reads a card and a double click plays one (`mtg-d0y1`), and
    // the named control is what every test that is not about the gesture
    // should be steering by anyway.
    const step = within(pool).getAllByRole('button', { name: addCopyLabel(card.name) })[0];
    if (step === undefined) throw new Error('the narrowed pool drew no face');
    for (let copy = 0; copy < copies; copy += 1) fireEvent.click(step);
  }

  it('is on screen in the default view, without touching the density control', () => {
    openDeckTab();
    fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
    playCopies(subject(), 3);
    const curve = screen.getByRole('list', { name: MANA_CURVE_LABEL });
    expect(
      within(curve).getByRole('listitem', { name: curveLabel(cardManaValue(subject()), 3) }),
    ).toBeTruthy();
  });

  it('counts cards rather than tiles, so a playset is four and not one', () => {
    openDeckTab();
    fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
    playCopies(subject(), CONSTRUCTED_COPY_LIMIT);
    const curve = screen.getByRole('list', { name: MANA_CURVE_LABEL });
    const rung = within(curve).getByRole('listitem', {
      name: curveLabel(cardManaValue(subject()), CONSTRUCTED_COPY_LIMIT),
    });
    expect(asElement(rung).textContent ?? '').toContain(String(CONSTRUCTED_COPY_LIMIT));
    // The pane's own header states the same number, which is the invariant that
    // makes a bare row of counts readable: they sum to what the pane says. Read
    // through `pickedCards`, since `mtg-dcxg.7` made that header count the
    // assembled deck — basics included — rather than the picks alone.
    expect(pickedCards()).toBe(CONSTRUCTED_COPY_LIMIT);
  });

  it('counts cards in the card view’s columns too, where the number used to be tiles', () => {
    openDeckTab();
    fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
    playCopies(subject(), CONSTRUCTED_COPY_LIMIT);
    fireEvent.click(
      within(screen.getByRole('group', { name: `${DECK_LABEL}, View` })).getByRole('button', {
        name: 'Full cards',
      }),
    );
    const deck = screen.getByRole('group', { name: 'Cards in your deck' });
    expect(
      within(deck).getByRole('group', {
        name: curveLabel(cardManaValue(subject()), CONSTRUCTED_COPY_LIMIT),
      }),
    ).toBeTruthy();
  });

  it('is the deck rather than the pool: an untouched build draws no curve at all', () => {
    openDeckTab();
    fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
    expect(screen.queryByRole('list', { name: MANA_CURVE_LABEL })).toBeNull();
  });
});

/**
 * The axis is the pane's, and both of this screen's panes hold DSL cards, so
 * both offer all four (`mtg-6599`). The pane a built artifact opens — over in
 * `../lab/deck-route.test.ts` — offers three, because its entries carry no
 * rarity, and that difference is what `offeredGroupings` exists for.
 */
describe('grouping the panes', () => {
  function selectFor(pane: string): { readonly options: readonly string[]; readonly value: string } {
    const control = screen.getByRole('combobox', { name: `${pane}, ${GROUPING_LABEL}` });
    const options = within(control)
      .getAllByRole('option')
      .map((option) => asElement(option).textContent ?? '');
    return { options, value: (control as unknown as { value: string }).value };
  }

  it('offers every axis in both panes, because a DSL card answers all four', () => {
    builderWith(emptyBuild(SET));
    for (const pane of [DECK_LABEL, CONSTRUCTED_POOL_LABEL]) {
      expect(selectFor(pane).options).toEqual(GROUPINGS.map(groupingLabel));
      expect(selectFor(pane).value).toBe('manaValue');
    }
  });

  it('regroups one pane without touching the other', () => {
    let build = emptyBuild(SET);
    for (let copy = 0; copy < CONSTRUCTED_COPY_LIMIT; copy += 1) build = addCopy(build, subject().id);
    builderWith(build);
    fireEvent.click(
      within(screen.getByRole('group', { name: `${DECK_LABEL}, View` })).getByRole('button', {
        name: 'Full cards',
      }),
    );
    const deck = screen.getByRole('group', { name: 'Cards in your deck' });
    expect(
      within(deck).queryByRole('group', {
        name: curveLabel(cardManaValue(subject()), CONSTRUCTED_COPY_LIMIT),
      }),
    ).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: `${DECK_LABEL}, ${GROUPING_LABEL}` }), {
      target: { value: 'cardType' },
    });

    const regrouped = screen.getByRole('group', { name: 'Cards in your deck' });
    expect(
      within(regrouped).queryByRole('group', {
        name: curveLabel(cardManaValue(subject()), CONSTRUCTED_COPY_LIMIT),
      }),
    ).toBeNull();
    // The column is now named for a type and still counts the same four cards,
    // which is the invariant every axis keeps: the heads sum to the pane.
    expect(
      within(regrouped)
        .getAllByRole('group')
        .some((group) => (asElement(group).getAttribute('aria-label') ?? '').endsWith(', 4 cards')),
    ).toBe(true);
    expect(
      (
        screen.getByRole('combobox', {
          name: `${CONSTRUCTED_POOL_LABEL}, ${GROUPING_LABEL}`,
        }) as unknown as { value: string }
      ).value,
    ).toBe('manaValue');
  });
});

describe('when the deck may be played', () => {
  it('refuses below sixty cards', () => {
    builderWith(addCopy(emptyBuild(SET), subject().id));
    expect(isDisabled(PLAY_LABEL)).toBe(true);
  });

  it('allows it at sixty, four copies each and the base making up the rest', () => {
    let build = emptyBuild(SET);
    const spells = CONSTRUCTED_DECK_SIZE - deckFor(build).lands.length;
    for (let at = 0; at * CONSTRUCTED_COPY_LIMIT < spells; at += 1) {
      for (let copy = 0; copy < CONSTRUCTED_COPY_LIMIT; copy += 1) build = addCopy(build, subject(at).id);
    }
    const deck = deckFor(build);
    expect(deck.deck.length).toBe(CONSTRUCTED_DECK_SIZE);
    expect(deck.excesses).toEqual([]);
    builderWith(build);
    expect(isDisabled(PLAY_LABEL)).toBe(false);
  });
});

describe('what the play buttons say about the other seat', () => {
  /** A legal sixty, which is what it takes to reach the note at all. */
  function sixty(): ConstructedBuild {
    let build = emptyBuild(SET);
    const spells = CONSTRUCTED_DECK_SIZE - deckFor(build).lands.length;
    for (let at = 0; at * CONSTRUCTED_COPY_LIMIT < spells; at += 1) {
      for (let copy = 0; copy < CONSTRUCTED_COPY_LIMIT; copy += 1) build = addCopy(build, subject(at).id);
    }
    return build;
  }

  function titleOf(label: string): string | null {
    const button = screen.getByRole('button', { name: label });
    return (button as unknown as { getAttribute(name: string): string | null }).getAttribute('title');
  }

  it('says what a mirror is when there is no second deck', () => {
    builderWith(sixty());
    expect(titleOf(PLAY_LABEL)).toBe(MIRROR_NOTE);
  });

  it('names the opponent instead, because the mirror sentence is then false', () => {
    // "Both seats play this deck: Constructed deals no second pool" is a true
    // fact about a mirror and a false one about a match, and it was still
    // printed over the button after the playtester chose an opponent on the
    // workbench's shelf. Found by driving the running lab: the deck the
    // workbench hands over and the sentence this toolbar prints are three files
    // apart, and nothing read either of them together.
    builderWith(sixty(), [], { opponentName: 'Vessari-v3' });
    expect(titleOf(PLAY_LABEL)).toBe('The other seat plays Vessari-v3.');
    expect(titleOf(PLAY_LABEL)).toBe(matchNote('Vessari-v3'));
  });

  it('keeps the refusal in that slot when the deck cannot be played at all', () => {
    // The slot carries a refusal when there is one, whatever the other seat
    // holds: a deck twelve cards short is not a game either way, and telling
    // somebody who they are about to play would answer a question they have not
    // reached yet.
    builderWith(addCopy(emptyBuild(SET), subject().id), [], { opponentName: 'Vessari-v3' });
    expect(titleOf(PLAY_LABEL)).not.toBe(matchNote('Vessari-v3'));
    expect(titleOf(PLAY_LABEL)).toContain('before the deck');
  });
});

/**
 * `ConstructedGame`'s `onStart` REPLACES the build rather than adding to it, so
 * a written deck's name in the toolbar is a discard-everything control with no
 * confirmation behind it. It is offered on an empty editor, which is the state
 * it is for, and taken away once there is work to lose; `Clear the deck` is the
 * way back to it, and is a deliberate press rather than a mis-aimed one.
 */
describe('starting from a written deck', () => {
  it('is offered while the editor is empty', () => {
    builderWith(emptyBuild(SET), STARTERS);
    expect(screen.getByRole('button', { name: 'A written deck' })).toBeTruthy();
  });

  it('is not offered once the deck holds cards it would throw away', () => {
    builderWith(addCopy(emptyBuild(SET), subject().id), STARTERS);
    expect(screen.queryByRole('button', { name: 'A written deck' })).toBeNull();
  });
});

/**
 * A pane with nothing in it says what it is empty of. The builder opens at zero
 * cards every time, so the empty deck pane is the *first* thing anybody sees of
 * it, and an empty `div` under a heading reads as a pane that failed rather than
 * as one waiting.
 */
describe('a pane holding nothing', () => {
  it('says the deck is empty rather than drawing an empty column', () => {
    builderWith(emptyBuild(SET));
    expect(screen.getByText(EMPTY_DECK_NOTE)).toBeTruthy();
    // The group keeps its name, so a reader who navigated to it still arrives.
    expect(
      within(screen.getByRole('group', { name: 'Cards in your deck' })).getByText(EMPTY_DECK_NOTE),
    ).toBeTruthy();
  });

  it('stops saying so once the deck holds a card', () => {
    builderWith(addCopy(emptyBuild(SET), subject().id));
    expect(screen.queryByText(EMPTY_DECK_NOTE)).toBeNull();
  });

  it('names the search that matched nothing rather than showing a blank pool', () => {
    builderWith(emptyBuild(SET));
    fireEvent.change(screen.getByLabelText(SEARCH_LABEL), {
      target: { value: 'zzzznotacardname' },
    });
    expect(screen.getByText(emptySearchNote('zzzznotacardname'))).toBeTruthy();
  });
});

/**
 * The full density, which since `mtg-rgc.21` is the same arrangement drawn bigger.
 *
 * The playtester, 2026-08-29: "the cards should be sorted by mana cost even when they
 * are in full expanded view not only in compact view". Both panes were already
 * emitting their cards in the grouping's order at both densities; what full did
 * not have was column boundaries and the counts over them, so the order was in
 * the markup and not in the drawing. These read the drawing.
 */
describe('full cards, in the same columns', () => {
  /** Presses the density control of one pane, the way a reader would. */
  function switchPane(label: string, to: 'Full cards' | 'Compact list'): void {
    fireEvent.click(
      within(screen.getByRole('group', { name: `${label}, View` })).getByRole('button', { name: to }),
    );
  }

  function playCopies(card: Card, copies: number): void {
    fireEvent.change(screen.getByLabelText(SEARCH_LABEL), { target: { value: card.name } });
    const pool = screen.getByRole('group', { name: CONSTRUCTED_POOL_LABEL });
    // The `+` under the face rather than the face itself. A click in the
    // collection reads a card and a double click plays one (`mtg-d0y1`), and
    // the named control is what every test that is not about the gesture
    // should be steering by anyway.
    const step = within(pool).getAllByRole('button', { name: addCopyLabel(card.name) })[0];
    if (step === undefined) throw new Error('the narrowed pool drew no face');
    for (let copy = 0; copy < copies; copy += 1) fireEvent.click(step);
  }

  it('keeps the deck pane in columns, with the count over each one', () => {
    openDeckTab();
    fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
    playCopies(subject(), CONSTRUCTED_COPY_LIMIT);
    switchPane(DECK_LABEL, 'Full cards');
    const deck = screen.getByRole('group', { name: DECK_CARDS_LABEL });
    expect(
      within(deck).getByRole('group', {
        name: curveLabel(cardManaValue(subject()), CONSTRUCTED_COPY_LIMIT),
      }),
    ).toBeTruthy();
    expect(asElement(deck).getAttribute('data-density')).toBe('full');
  });

  it('draws a whole face in each strip, which is the whole of what full means', () => {
    openDeckTab();
    fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
    playCopies(subject(), 2);
    switchPane(DECK_LABEL, 'Full cards');
    const region = asElement(screen.getByRole('group', { name: DECK_CARDS_LABEL }));
    expect(region.getAttribute('data-density')).toBe('full');
    // One face per copy, each drawn at the size the card face calls full. Since
    // mtg-mxkrk the compact density draws name bars and nothing else, so the
    // whole of what full buys is the picture and this is the difference between
    // the two densities rather than decoration.
    expect(region.querySelectorAll('.mtg-card[data-size="full"]').length).toBe(2);
    // The other half of the same statement, taken on the one pane of this
    // screen that draws at compact: no illustration anywhere in it. The deck
    // pane offers list and full only (`DECK_VIEW_MODES_OFFERED`), so the
    // collection is where compact is drawn here.
    // Pressed rather than inherited: the pool opens on whole cards too since
    // 2026-09-17 (`../../src/routes/deck/DeckPane.ts`'s `PANE_CARD_VIEWS`).
    // `mtg-eeqnj`: compact now draws the pool as `StripColumns`, like the deck
    // pane, so the marker is `data-density` (the strips' own attribute) rather
    // than `data-view` (`CurveColumns`', which the pool only carries at full).
    switchPane(CONSTRUCTED_POOL_LABEL, 'Compact list');
    const compact = asElement(screen.getByRole('group', { name: CONSTRUCTED_POOL_LABEL }));
    expect(compact.getAttribute('data-density')).toBe('compact');
    expect(compact.querySelectorAll('.mtg-art').length).toBe(0);
    expect(compact.querySelectorAll('img').length).toBe(0);
  });

  it('draws the pool in columns too, headed and counted', () => {
    openDeckTab();
    fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
    switchPane(CONSTRUCTED_POOL_LABEL, 'Full cards');
    const pool = screen.getByRole('group', { name: CONSTRUCTED_POOL_LABEL });
    expect(asElement(pool).getAttribute('data-view')).toBe('full');
    expect(within(pool).getAllByRole('group', { name: /^Mana value/ }).length).toBeGreaterThan(1);
  });
});

/**
 * `mtg-eeqnj`. The pool drew small card-shaped tiles at compact -- titles and
 * no art, which met `mtg-mxkrk`'s letter but was a second drawing under the
 * one word "Compact list" the deck pane's own strips already answer. This
 * asserts the pool now reaches `../../src/routes/deck/StripColumns.ts` too,
 * one strip per distinct card regardless of how many copies are already
 * played, with the pool's own gestures preserved on it.
 */
describe('the pool pane at compact, drawn as strips like the deck pane', () => {
  function switchPane(label: string, to: 'Full cards' | 'Compact list'): void {
    fireEvent.click(
      within(screen.getByRole('group', { name: `${label}, View` })).getByRole('button', { name: to }),
    );
  }

  it('draws one strip per card, not one per copy already in the deck', () => {
    openDeckTab();
    fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
    const card = subject();
    playFromPool(card, CONSTRUCTED_COPY_LIMIT);
    switchPane(CONSTRUCTED_POOL_LABEL, 'Compact list');
    const pool = screen.getByRole('group', { name: CONSTRUCTED_POOL_LABEL });
    // `../../src/routes/deck/strips.ts`'s `StripFacts.copies` rule for a pool: every card is
    // exactly one strip, whatever the deck pane already counts.
    expect(within(pool).getAllByRole('button', { name: new RegExp(`^${card.name}$`, 'u') })).toHaveLength(1);
  });

  it('reads a card on a click, plays a copy on a double click, and cuts one on a right click', () => {
    openDeckTab();
    fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
    const card = subject();
    playFromPool(card, 1);
    switchPane(CONSTRUCTED_POOL_LABEL, 'Compact list');
    const pool = screen.getByRole('group', { name: CONSTRUCTED_POOL_LABEL });
    const strip = within(pool).getByRole('button', { name: new RegExp(`^${card.name}$`, 'u') });

    // A click reads the card rather than playing it -- the same grammar
    // `mtg-d0y1` gave the full-density face.
    fireEvent.click(strip);
    expect(pickedCards()).toBe(1);
    expect(asElement(strip).getAttribute('aria-pressed')).toBe('true');

    // click, click, dblclick is the sequence a browser delivers for a real
    // double click; the guard on the strip's own click handler is what keeps
    // the second click from re-selecting before the double click plays.
    fireEvent.click(strip, { detail: 1 });
    fireEvent.click(strip, { detail: 2 });
    fireEvent.doubleClick(strip);
    expect(pickedCards()).toBe(2);

    fireEvent.contextMenu(strip);
    expect(pickedCards()).toBe(1);
  });
});
