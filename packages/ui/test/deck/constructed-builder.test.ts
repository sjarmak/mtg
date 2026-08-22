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
  DECK_LABEL,
  MANA_CURVE_LABEL,
  PLAY_LABEL,
  SEARCH_LABEL,
} from '../../src/routes/deck/ConstructedBuilder';
import { curveLabel } from '../../src/routes/deck/columns';
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

function builderWith(build: ConstructedBuild): void {
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
    }),
  );
}

/**
 * Narrows what testing-library hands back to the members these assertions use.
 * The workspace tsconfig has no `lib: dom`, so `HTMLElement` carries none of
 * them and the check has to happen at runtime, as `../play/sealed.test.ts` does
 * for the same reason.
 */
interface ElementLike {
  readonly nextElementSibling: { readonly textContent: string | null } | null;
  readonly hasAttribute: (name: string) => boolean;
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

describe('playing copies of a card', () => {
  it('counts them up from the pool and back down from the deck', () => {
    openDeckTab();
    fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
    const card = subject();
    fireEvent.change(screen.getByLabelText(SEARCH_LABEL), { target: { value: card.name } });
    const pool = screen.getByRole('group', { name: 'Playable cards' });
    const face = within(pool).getAllByRole('button', { name: new RegExp(card.name, 'u') })[0];
    if (face === undefined) throw new Error('the narrowed pool drew no face');
    fireEvent.click(face);
    fireEvent.click(face);
    expect(screen.getAllByText('2 in deck').length).toBeGreaterThan(0);
    expect(factValue('spells').startsWith('2/')).toBe(true);

    const deck = screen.getByRole('group', { name: 'Cards in your deck' });
    const inDeck = within(deck).getAllByRole('button', { name: new RegExp(card.name, 'u') })[0];
    if (inDeck === undefined) throw new Error('the deck pane drew no face');
    fireEvent.click(inDeck);
    expect(factValue('spells').startsWith('1/')).toBe(true);
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
 * pins the same rule for a built artifact and `./columns.ts` argues it. The
 * columns exist only in the compact pane, and `../../src/routes/deck/view-mode.ts`
 * makes full the default, so the answer was two presses away. And the pool pane
 * drew columns too, which is a different question from the one that was asked.
 */
describe('the curve of the deck being built', () => {
  /** Plays `copies` of one pool card through the screen, as a person would. */
  function playCopies(card: Card, copies: number): void {
    fireEvent.change(screen.getByLabelText(SEARCH_LABEL), { target: { value: card.name } });
    const pool = screen.getByRole('group', { name: 'Playable cards' });
    const face = within(pool).getAllByRole('button', { name: new RegExp(card.name, 'u') })[0];
    if (face === undefined) throw new Error('the narrowed pool drew no face');
    for (let copy = 0; copy < copies; copy += 1) fireEvent.click(face);
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
    // makes a bare row of counts readable: they sum to what the pane says.
    expect(screen.getByText(new RegExp(`^${String(CONSTRUCTED_COPY_LIMIT)} cards ·`, 'u'))).toBeTruthy();
  });

  it('counts cards in the compact columns too, where the number used to be tiles', () => {
    openDeckTab();
    fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
    playCopies(subject(), CONSTRUCTED_COPY_LIMIT);
    fireEvent.click(
      within(screen.getByRole('group', { name: `${DECK_LABEL}, View` })).getByRole('button', {
        name: 'Compact list',
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
