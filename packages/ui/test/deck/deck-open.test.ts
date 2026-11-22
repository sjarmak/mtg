// @vitest-environment jsdom
/**
 * A link that names a deck opens that deck (`mtg-aqxi.19`).
 *
 * The landing page lists the decks this browser has and the decks the staged
 * set was written with, and the playtester asked for that list to carry "the build a
 * deck or edit a deck options". A row that lands on the Decks tab and leaves you
 * to find the deck again is not an edit option, so a row is a real link with the
 * deck in it, and this file is the other end: arrive with `?open=` and the tab
 * opens on what it names.
 *
 * The saved-deck arm is the one worth asserting through the screen rather than
 * against the parser. Opening a saved deck crosses three components — the tab
 * chooses the builder, the builder is handed the id, and the panel that owns the
 * list does the load and the naming — and each of those seams can be wired
 * wrong in a way that still typechecks.
 *
 * No card name is written down: every subject is picked out of the committed
 * prototype set by shape.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { DeckRoute } from '../../src/routes/DeckRoute';
import { deckOpenParam, parseDeckOpen } from '../../src/routes/deck/open';
import type { DeckOpen } from '../../src/routes/deck/open';
import { NO_SUCH_DECK_NOTE } from '../../src/routes/deck/SavedDecksPanel';
import { addCopy, emptyBuild, selectable, spellCount } from '../../src/routes/deck/build';
import { toSavedDeck, writeSavedDecks } from '../../src/routes/deck/saved-decks';

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

/** Writes a deck of `copies` cards straight to the store the panel reads. */
function store(id: string, name: string, copies: number): void {
  let build = emptyBuild(SET);
  for (let copy = 0; copy < copies; copy += 1) build = addCopy(build, subject().id);
  writeSavedDecks([toSavedDeck(id, name, build, '2026-08-22T00:00:00.000Z')]);
}

function arrive(open: string): void {
  render(h(DeckRoute, { state: { status: 'absent' as const }, cards: SET, open }));
}

describe('the deck a link names', () => {
  const cases: readonly (readonly [string, DeckOpen])[] = [
    ['build', { kind: 'build' }],
    ['saved:d-1', { kind: 'build', savedId: 'd-1' }],
    ['precon:a-written-deck', { kind: 'precon', id: 'a-written-deck' }],
    // The Cards tab's deck gallery links here (`mtg-a982g.1`): a built deck,
    // opened in the workbench rather than in the builder.
    ['variation:v-1', { kind: 'variation', id: 'v-1' }],
  ];

  it.each(cases)('round-trips %s', (raw, open) => {
    expect(parseDeckOpen(raw)).toEqual(open);
    expect(deckOpenParam(open)).toBe(raw);
  });

  it.each(['', 'saved:', 'precon:', 'variation:', 'nonsense', 'saved', undefined])(
    'reads %s as no request at all rather than as an error',
    (raw) => {
      expect(parseDeckOpen(raw)).toBeNull();
    },
  );
});

describe('arriving on the Decks tab with a deck named', () => {
  it('opens a saved deck in the builder, with its cards on screen', () => {
    store('d-1', 'the list I keep coming back to', 3);
    arrive(deckOpenParam({ kind: 'build', savedId: 'd-1' }));
    // The name is the panel's own field, filled by the load rather than typed.
    expect(screen.getByDisplayValue('the list I keep coming back to')).toBeTruthy();
    // The card is on screen more than once — the pool draws it and so does the
    // deck pane — which is itself the assertion that the deck came back.
    expect(screen.getAllByText(subject().name).length).toBeGreaterThan(1);
  });

  it('says so when the link names a deck this browser has not got', () => {
    store('d-1', 'the one that is here', 3);
    arrive(deckOpenParam({ kind: 'build', savedId: 'd-elsewhere' }));
    expect(screen.getByText(NO_SUCH_DECK_NOTE)).toBeTruthy();
  });

  it('opens the builder empty when the link asks for a build and nothing else', () => {
    arrive(deckOpenParam({ kind: 'build' }));
    expect(spellCount(emptyBuild(SET))).toBe(0);
    expect(screen.queryByText(NO_SUCH_DECK_NOTE)).toBeNull();
  });
});

/**
 * The link opens the deck, and the pool it needs arrives a moment later.
 *
 * `mtg-ti4v`. The Constructed pool is every staged set's cards (`78307be0`),
 * which is what lets a deck cut from one set open while the header names
 * another. But that union is fetched: `LabApp`'s `useSetLibrary` reads every
 * bundle in the index over the network, and this route mounts before any of it
 * lands, with `poolSets` absent and `cards` holding the one set the header
 * names. The panel's link-open effect used to fire on that first render, refuse
 * the deck for ids the one set does not print, and latch — so a deck link
 * across sets answered "the staged set no longer holds" and never retried once
 * the set it needed was there.
 */
describe('a link to a deck cut from a set that is still loading', () => {
  /** The pool split in two, so a deck of the second half is refused by the first. */
  function halves(): { readonly here: readonly Card[]; readonly elsewhere: readonly Card[] } {
    const playable = selectable(SET);
    const cut = Math.floor(playable.length / 2);
    return { here: playable.slice(0, cut), elsewhere: playable.slice(cut) };
  }

  /** Writes a deck of `copies` copies of the first card of `from`. */
  function storeFrom(id: string, name: string, from: readonly Card[], copies: number): Card {
    const card = from[0];
    if (card === undefined) throw new Error('the half is empty');
    let build = emptyBuild(from);
    for (let copy = 0; copy < copies; copy += 1) build = addCopy(build, card.id);
    writeSavedDecks([toSavedDeck(id, name, build, '2026-08-22T00:00:00.000Z')]);
    return card;
  }

  it('opens it once the other set arrives, rather than refusing it on the first render', () => {
    const { here, elsewhere } = halves();
    const card = storeFrom('d-1', 'the one cut from the other set', elsewhere, 3);
    const open = deckOpenParam({ kind: 'build', savedId: 'd-1' });
    const view = render(h(DeckRoute, { state: { status: 'absent' as const }, cards: here, open }));
    // The union has not arrived, so nothing can open yet. What matters is that
    // the request is still outstanding rather than answered with a refusal.
    view.rerender(
      h(DeckRoute, {
        state: { status: 'absent' as const },
        cards: here,
        open,
        poolSets: [
          { name: 'the set the header names', cards: here },
          { name: 'the set the deck was cut from', cards: elsewhere },
        ],
      }),
    );
    expect(screen.getByDisplayValue('the one cut from the other set')).toBeTruthy();
    expect(screen.getAllByText(card.name).length).toBeGreaterThan(1);
  });
});
