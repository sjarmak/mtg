// @vitest-environment jsdom
/**
 * The Decks tab as a library rather than a row of buttons.
 *
 * The playtester's instruction: "replace the row of pill buttons with a real deck
 * library" whose preconstructed shelf uses "the same `DeckCard` component used
 * in Play". Three claims are worth pinning, and the first two are about copy
 * that had leaked out of a build script and onto a page a person reads.
 *
 * 1. **A deck is named, not annotated.** The buttons read `The Sky Islands ·
 *    preconstructed` and `Database build: <the prompt>`, which is a shelf label
 *    stapled to every item on the shelf. The tile carries the kind as a badge
 *    now, and the shelf carries the set (`mtg-tewc.6`).
 * 2. **The counts are stated, and the empty shelf is stated.** `5
 *    preconstructed · 0 saved` is the whole of what a library owes a person
 *    arriving at it, and *No saved decks yet.* is the answer to the question the
 *    absence otherwise leaves open.
 * 3. **The tile is the Play tab's tile.** Asserted by its accessible name and
 *    its class, because the component being shared is the point: two screens
 *    drawing the same five decks two ways is what this replaced.
 *
 * The precon file is built here out of the committed prototype set, the way
 * `../play/precon.test.ts` builds one out of invented cards: this tab knows
 * nothing about any particular set, and a test that borrowed the flagship's
 * decks would be asserting on those decks instead.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { PreconFile } from '@mtg/deckbuild';
import { parsePreconFile } from '@mtg/deckbuild';
import {
  BUILD_LABEL,
  DECKS_BACK_LABEL,
  DECKS_EMPTY_NOTE,
  DeckRoute,
  deckLibraryCounts,
  IMPORT_LABEL,
  openDeckLabel,
} from '../../src/routes/DeckRoute';
import { counted, DECK_CARD_KIND_LABELS, deckCountsLine } from '../../src/routes/deck/DeckCard';
import { SET_ORIGIN_LABELS } from '../../src/lab/set-origin';
import { selectable } from '../../src/routes/deck/build';
import { DECK_TEXT_LABEL } from '../../src/routes/deck/DeckFilePanel';
import { DESCRIBE_LABEL } from '../../src/routes/deck/DeckLibrary';
import {
  SAVED_SOURCE_LABELS,
  savedCardCount,
  savedDeckDocument,
  writeSavedDecks,
} from '../../src/routes/deck/saved-decks';
import type { SavedDeck } from '../../src/routes/deck/saved-decks';
import { deckOpenParam } from '../../src/routes/deck/open';
import type { DeckRouteProps } from '../../src/routes/deck/route-state';
import { resetDeckKeeping } from '../../src/routes/deck/deck-keeping';

/** The staged set the shelves are drawn under: a generated one, as the lab's own. */
const STAGED = { name: 'The Tideglass Prototype', origin: 'custom' as const };

afterEach(cleanup);

afterEach((): void => {
  const host = globalThis as { readonly localStorage?: { clear?: () => void } };
  host.localStorage?.clear?.();
  resetDeckKeeping();
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

/** Six playable cards, six copies each, which is a 36-spell list. */
const SPELL_IDS = selectable(SET)
  .slice(0, 6)
  .map((card) => card.id);

const FIRST_SPELL = SPELL_IDS[0];
if (FIRST_SPELL === undefined) throw new Error('the prototype set has no selectable card');

const FILE: PreconFile = parsePreconFile({
  formatVersion: 1,
  setCode: 'TGR',
  decks: [
    {
      id: 'tide',
      name: 'The Tide Comes In',
      plan: 'Hold the board and win late.',
      payoff: FIRST_SPELL,
      deckSize: 60,
      basics: { U: 24 },
      spells: SPELL_IDS.map((id) => ({ id, count: 6 })),
    },
    {
      id: 'reach',
      name: 'The Reach Answers',
      plan: 'Trade early and swing.',
      payoff: FIRST_SPELL,
      deckSize: 60,
      basics: { R: 24 },
      spells: SPELL_IDS.map((id) => ({ id, count: 6 })),
    },
  ],
});

/**
 * A rendered element, narrowed by hand.
 *
 * There is no `lib: dom` in this workspace, so `document` is not a name that
 * typechecks even though jsdom provides one. `./workbench-route.test.ts` and
 * `../board-face-cost.test.ts` reach an element the same way.
 */
interface ElementLike {
  readonly querySelector: (selector: string) => ElementLike | null;
}

/** The tab as a checkout that ran `npm run play` has it: a set and its decks. */
function openLibrary(extra: Omit<DeckRouteProps, 'state' | 'cards'> = {}): ElementLike {
  const { container } = render(
    h(DeckRoute, {
      state: { status: 'absent' as const },
      cards: SET,
      precons: { status: 'ready' as const, file: FILE },
      set: STAGED,
      ...extra,
    }),
  );
  return container as unknown as ElementLike;
}

/** The text of an element, narrowed by hand: no `lib: dom` in this workspace. */
function textOf(value: unknown): string {
  if (typeof value !== 'object' || value === null || !('textContent' in value)) return '';
  const { textContent } = value as { textContent: unknown };
  return typeof textContent === 'string' ? textContent : '';
}

/**
 * A deck server with one built variation on its shelf, cut from this fixture's
 * own cards so the reopen resolves.
 *
 * Only the four routes this journey touches. It is a stub rather than a running
 * server because what is being asserted is the frame the route puts the builder
 * in, which is decided in `../../src/routes/deck/DeckLibrary.ts` and has nothing
 * to do with how the deck arrived.
 */
function stubDeckServer(): void {
  const spells = SPELL_IDS.map((id) => {
    const card = SET.find((entry) => entry.id === id);
    return {
      id,
      name: card?.name ?? id,
      count: 4,
      manaCost: '{1}{U}',
      manaValue: 2,
      typeLine: 'Creature — Merfolk',
      criteria: [],
      reason: 'a body on the board',
    };
  });
  const variation = {
    version: 1,
    id: 'v1',
    name: 'tide tempo',
    builtAt: '2026-09-01T12:00:00.000Z',
    parentId: null,
    criteria: { prompt: 'a tempo deck', sets: ['TGR'], colors: ['U'], size: 60, maxCopies: 4, themes: [] },
    statedCriteria: [],
    plan: 'curve out',
    spells,
    lands: [],
    basics: [],
    manaBase: {
      totalLands: 24,
      nonBasicLands: 0,
      castabilityTarget: 0.9,
      heavyCastabilityTarget: 0.8,
      colors: [],
      landReason: 'a two-color tempo deck',
      landSource: 'model' as const,
    },
    universeSize: 40,
    shortfalls: [],
  };
  // Thirty-six Islands under twenty-four spells: a legal sixty, which is what it
  // takes to reach the play button at all. `setBasics` decides this id, which is
  // the same function the pool this is reopened against was built through.
  const withBasics = { ...variation, basics: [{ color: 'U' as const, count: 36, id: 'tgr-island' }] };
  // A second deck on the shelf, so there is something to play against. Same
  // cards, different id and name: what is under test is which deck the page
  // asks the server for, not what is in it.
  const rival = { ...withBasics, id: 'v2', name: 'the other deck' };
  vi.stubGlobal('fetch', (input: string) => {
    const url = String(input);
    asked.push(url);
    const answer = (body: unknown): Promise<Response> =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
    if (url.endsWith('/deck-api/sets')) {
      return answer({ sets: [{ code: 'TGR', name: STAGED.name, cardCount: SET.length }], builds: false });
    }
    if (url.endsWith('/deck-api/variations')) {
      return answer({
        variations: [withBasics, rival].map((deck) => ({
          id: deck.id,
          name: deck.name,
          builtAt: deck.builtAt,
          parentId: null,
          prompt: 'a tempo deck',
          sets: ['TGR'],
          totalCards: 24,
          shortfallCount: 0,
        })),
        unreadable: [],
      });
    }
    if (url.endsWith('/deck-api/variations/v2')) return answer(rival);
    if (url.includes('/deck-api/variations/')) return answer(withBasics);
    return answer({});
  });
}

/** Every url the stub was asked for, in order, so a test can name one. */
const asked: string[] = [];

afterEach((): void => {
  vi.unstubAllGlobals();
  asked.length = 0;
});

describe('the decks the workbench built', () => {
  it('lists them on the Decks tab, which is the screen named for decks', async () => {
    // `mtg-yp33.8`. They were reachable only by pressing `Describe a deck` and
    // then scrolling the workbench's left column 548px past the form to a
    // heading called Variations — measured on the running lab at 1600x1000. The
    // tab that lists decks listed none of the seven this lab had built.
    stubDeckServer();
    openLibrary();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: openDeckLabel('tide tempo') })).toBeTruthy();
    });
  });

  it('says on the tile what kind of deck it is, the way every other tile does', async () => {
    stubDeckServer();
    openLibrary();

    await waitFor(() => {
      const tile = screen.getByRole('button', { name: openDeckLabel('tide tempo') });
      expect(textOf(tile)).toContain(DECK_CARD_KIND_LABELS.variation);
    });
  });

  it('shelves one under the staged set it was cut from', async () => {
    // A variation names its sets, so it belongs under one rather than under
    // "Not from a staged set" — which is where a row with no set ends up.
    stubDeckServer();
    const container = openLibrary();

    await waitFor(() => {
      const shelf = container.querySelector(`[aria-label="${STAGED.name}"]`);
      expect(textOf(shelf)).toContain('tide tempo');
    });
  });

  it('opens that variation in the workbench rather than whichever one is newest', async () => {
    stubDeckServer();
    openLibrary();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: openDeckLabel('tide tempo') })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: openDeckLabel('tide tempo') }));

    await waitFor(() => {
      expect(screen.getByText('curve out')).toBeTruthy();
    });
  });

  it('opens the workbench on the variation a link names', async () => {
    // `mtg-a982g.1`. The Cards tab's gallery draws a built deck as a link to
    // the workbench, open on that deck, and this is the other end of the link:
    // the same param the saved-deck and precon links ride on, with a third arm.
    stubDeckServer();
    openLibrary({ open: deckOpenParam({ kind: 'variation', id: 'v1' }) });

    await waitFor(() => {
      expect(screen.getByText('curve out')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: openDeckLabel('tide tempo') })).toBeNull();
  });

  it('says nothing at all when no deck server is running, which is the ordinary case', async () => {
    // `npm run play` alone serves no `/deck-api`, so the fetch fails. A tab that
    // drew an empty Built-from-a-description shelf there would be advertising a
    // feature this checkout does not have running.
    vi.stubGlobal('fetch', () => Promise.reject(new Error('connection refused')));
    const container = openLibrary();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: DESCRIBE_LABEL })).toBeTruthy();
    });
    expect(textOf(container)).not.toContain(DECK_CARD_KIND_LABELS.variation);
  });
});

describe('a variation played from the workbench', () => {
  it('reports the seat up to the shell, and reports it given back', async () => {
    // The shell keeps its standing notice off a table (`../../src/app/App.ts` on
    // `seated`), and this route is the one that seats a game on a tab that is
    // not Play, so it is the one that has to say so.
    stubDeckServer();
    const seats: boolean[] = [];
    openLibrary({ onPlayingChange: (playing) => seats.push(playing) });
    fireEvent.click(screen.getByRole('button', { name: DESCRIBE_LABEL }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play this deck' })).toBeTruthy();
    });
    expect(seats.at(-1)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Play this deck' }));

    await waitFor(() => {
      expect(seats.at(-1)).toBe(true);
    });
  });

  it('lands in the same frame a hand-built deck does, rather than in a document', async () => {
    // `mtg-yp33`'s play path returned the builder bare where every other path
    // into it wraps it in `builderScreen`. Measured on the running lab, the route
    // became a 24,850px document at a 1000px viewport with a 24,676px pool pane
    // that did not scroll — the failure `mtg-nuk3`, `mtg-pmpu` and `mtg-tz11`
    // fixed, reinstated on the one path nothing rendered. jsdom lays nothing out,
    // so what is asserted is the frame itself, which is the thing that was
    // missing.
    stubDeckServer();
    const container = openLibrary();
    fireEvent.click(screen.getByRole('button', { name: DESCRIBE_LABEL }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play this deck' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Play this deck' }));

    await waitFor(() => {
      expect(container.querySelector('.mtg-builder-screen')).toBeTruthy();
    });
    // And the frame's own scrollport with it, which is the part that makes the
    // panes boxes rather than a document.
    expect(container.querySelector('.mtg-work__scroll')).toBeTruthy();
  });
});

describe('the deck library', () => {
  it('says what it holds, in the two counts a person arriving needs', () => {
    openLibrary();
    expect(screen.getByText(deckLibraryCounts(2, 0))).toBeTruthy();
  });

  it('shelves the written decks under their set, under the taxonomy heading', () => {
    openLibrary();
    // The origin heading is the taxonomy's own label, and the value behind it is
    // never on screen: the playtester's instruction is that a person reads *Magic*.
    expect(screen.getByRole('heading', { name: SET_ORIGIN_LABELS.custom })).toBeTruthy();
    expect(screen.queryByText(/official/i)).toBeNull();
    const shelf = within(screen.getByRole('group', { name: STAGED.name }));
    for (const deck of FILE.decks) {
      expect(shelf.getByRole('button', { name: openDeckLabel(deck.name) })).toBeTruthy();
    }
    expect(screen.queryByText(/· preconstructed/)).toBeNull();
    expect(screen.queryByText(/Database build:/)).toBeNull();
  });

  it('draws no group for a taxonomy nothing is shelved under', () => {
    openLibrary();
    // The staged set is a generated one, so there is no Magic shelf to draw and
    // an empty heading over nothing is what the spec's availability rule forbids.
    expect(screen.queryByRole('heading', { name: SET_ORIGIN_LABELS.official })).toBeNull();
  });

  it('says on the tile which kind of deck it is', () => {
    openLibrary();
    const first = FILE.decks[0];
    if (first === undefined) throw new Error('the fixture holds two decks');
    const tile = screen.getByRole('button', { name: openDeckLabel(first.name) });
    expect(textOf(tile)).toContain(DECK_CARD_KIND_LABELS.precon);
  });

  it('draws a deck with the tile the Play tab draws', () => {
    openLibrary();
    const first = FILE.decks[0];
    if (first === undefined) throw new Error('the fixture holds two decks');
    const tile = screen.getByRole('button', { name: openDeckLabel(first.name) });
    expect(textOf(tile)).toContain(first.plan);
    expect(textOf(tile)).toContain(first.name);
  });

  it('says the library is empty rather than drawing a title over a blank', () => {
    render(h(DeckRoute, { state: { status: 'absent' as const }, cards: SET, set: STAGED }));
    expect(screen.getByText(DECKS_EMPTY_NOTE)).toBeTruthy();
  });

  it('opens the builder on the primary action, and comes back from it', () => {
    openLibrary();
    fireEvent.click(screen.getByRole('button', { name: BUILD_LABEL }));
    // The builder is a workspace: the shelves are gone while it is open.
    expect(screen.queryByRole('group', { name: STAGED.name })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: DECKS_BACK_LABEL }));
    expect(screen.getByRole('group', { name: STAGED.name })).toBeTruthy();
  });

  it('opens the same builder for an import, with the decklist box on screen', () => {
    openLibrary();
    fireEvent.click(screen.getByRole('button', { name: IMPORT_LABEL }));
    // The one builder (`deck/open.ts`), reached in the state that takes a list:
    // the box is already open rather than behind the disclosure that holds it.
    expect(screen.getByRole('button', { name: DECKS_BACK_LABEL })).toBeTruthy();
    expect(screen.getByLabelText(DECK_TEXT_LABEL)).toBeTruthy();
  });

  // Pressing a tile used to select it and draw the deck below the shelves, so
  // this asserted the tile's own pressed state. `mtg-nuk3` gave an open deck the
  // whole route on the argument the builder above already makes, so what the
  // press produces is the deck's own screen: its name at the head, the way out
  // beside it, and the shelves gone until it is taken.
  it('gives a written deck the whole route when its tile is pressed, and comes back', () => {
    openLibrary();
    const second = FILE.decks[1];
    if (second === undefined) throw new Error('the fixture holds two decks');
    fireEvent.click(screen.getByRole('button', { name: openDeckLabel(second.name) }));
    expect(screen.getByRole('heading', { name: second.name })).toBeTruthy();
    expect(screen.queryByRole('group', { name: STAGED.name })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: DECKS_BACK_LABEL }));
    expect(screen.getByRole('button', { name: openDeckLabel(second.name) })).toBeTruthy();
  });
});

describe('one built deck against another', () => {
  it('fetches the chosen opponent, because the shelf row carries no decklist', async () => {
    // The playtester asked to play the Alaric deck against the Vessari deck. The dealer
    // that seats two built lists is `../play/deck-match.test.ts`; what this
    // pins is the leg between the picker and it. The shelf sends summaries, so
    // the opponent's cards are not on the page when it is chosen, and the
    // reopen has to happen against the pool this route owns.
    stubDeckServer();
    const container = openLibrary();
    fireEvent.click(screen.getByRole('button', { name: DESCRIBE_LABEL }));

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Opponent' })).toBeTruthy();
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Opponent' }), { target: { value: 'v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Play this deck' }));

    await waitFor(() => {
      expect(asked.some((url) => url.endsWith('/deck-api/variations/v2'))).toBe(true);
    });
    // And it still reaches the table, rather than stopping on the fetch.
    await waitFor(() => {
      expect(container.querySelector('.mtg-builder-screen')).toBeTruthy();
    });
  });

  it('plays the mirror when no opponent was chosen, which is the old behavior', async () => {
    stubDeckServer();
    const container = openLibrary();
    fireEvent.click(screen.getByRole('button', { name: DESCRIBE_LABEL }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play this deck' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Play this deck' }));

    await waitFor(() => {
      expect(container.querySelector('.mtg-builder-screen')).toBeTruthy();
    });
    expect(asked.some((url) => url.endsWith('/deck-api/variations/v2'))).toBe(false);
  });
});

describe('pressing play on a deck the workbench built', () => {
  it('seats the game, instead of redrawing the builder', async () => {
    // Found driving the running lab for the playtester's "play the Alaric deck against
    // the Vessari deck": the button was live, its click handler ran, no error was
    // raised, and the builder was still on screen fifteen seconds later.
    //
    // The cause is React reconciliation rather than anything about the game.
    // `ConstructedGame` holds the dealt table in its own state and reports the
    // start through `onPlayingChange`; the route answered that by returning a
    // *different tree* — `builderScreen`'s four nested divs while building, a
    // bare div with a page head while playing. A child at a different position
    // is a different child, so `ConstructedGame` unmounted and remounted with
    // `playing` back to null in the same commit that set it. The table was
    // discarded the instant it was dealt, on every Constructed path into a game.
    stubDeckServer();
    const container = openLibrary();
    fireEvent.click(screen.getByRole('button', { name: DESCRIBE_LABEL }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play this deck' })).toBeTruthy();
    });
    // The workbench's own button: hands the variation to the builder.
    fireEvent.click(screen.getByRole('button', { name: 'Play this deck' }));

    await waitFor(() => {
      expect(container.querySelector('.mtg-builder-screen')).toBeTruthy();
    });
    // The builder's own button, which is the one that deals.
    const play = screen.getByRole('button', { name: 'Play this deck' });
    expect((play as unknown as { disabled: boolean }).disabled).toBe(false);
    fireEvent.click(play);

    await waitFor(() => {
      expect(container.querySelector('.mtg-live')).toBeTruthy();
    });
  });
});

describe('the head over a match', () => {
  it('names both decks, because the board itself names neither', async () => {
    // Driving the running lab: the game came up, and the only deck name anywhere
    // on the screen was the one being played. The seats read "You" and "Bot",
    // which is `dealPreconGame`'s deliberate choice and right there — the seat
    // is not the deck — but it leaves "who am I playing?" unanswered on a screen
    // whose whole point is that it is a specific second deck.
    stubDeckServer();
    openLibrary();
    fireEvent.click(screen.getByRole('button', { name: DESCRIBE_LABEL }));

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Opponent' })).toBeTruthy();
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Opponent' }), { target: { value: 'v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Play this deck' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play this deck' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Play this deck' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'tide tempo vs the other deck' })).toBeTruthy();
    });
  });

  it('names one deck when it is a mirror, because there is only one', async () => {
    stubDeckServer();
    openLibrary();
    fireEvent.click(screen.getByRole('button', { name: DESCRIBE_LABEL }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play this deck' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Play this deck' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play this deck' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Play this deck' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'tide tempo' })).toBeTruthy();
    });
  });
});

describe('a deck handed over from the workbench', () => {
  it('does not open the save panel over the screen on arrival', async () => {
    // The playtester: "when I click play this deck it just pops up the
    // import/export save this deck view."
    //
    // `SavedDecksPanel` starts open when `readSavedDecks().length > 0 ||
    // spellCount(build) > 0`, read once at mount — a library to browse, or a
    // deck worth naming before it is lost. A deck handed over from the
    // workbench arrives with sixty cards already in it, so the second half is
    // true the instant the builder mounts and the save controls open over the
    // workspace. It reads as pressing Play and being asked to save.
    //
    // Neither half of the rule is about this deck: the person did not build it
    // here and it is already saved on the deck server. The disclosure is still
    // there, still named, one press away.
    stubDeckServer();
    const container = openLibrary();
    fireEvent.click(screen.getByRole('button', { name: DESCRIBE_LABEL }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play this deck' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Play this deck' }));

    await waitFor(() => {
      expect(container.querySelector('.mtg-builder-screen')).toBeTruthy();
    });
    // The disclosure's own state, not whether its contents are in the document:
    // jsdom applies no user-agent stylesheet, so a shut `<details>` still holds
    // every one of its children and `queryByRole` finds them all.
    const bar = container.querySelector('.mtg-savebar__disclosure');
    expect(bar).toBeTruthy();
    expect((bar as unknown as { open: boolean }).open).toBe(false);
  });
});

/**
 * A saved tile says where the deck came from.
 *
 * `mtg-j1rg`. Until this lane the Constructed builder's save panel was the only
 * surface in the lab that could write a deck, so *saved* and *built here* were
 * the same word and the tile had no reason to say which. Sealed and Draft can
 * keep a deck now, three histories file under one badge, and the difference is
 * the first thing somebody looking for the deck they just cut out of six packs
 * is looking for.
 *
 * A deck saved before the source existed carries none, and reads as Constructed
 * rather than as nothing: that panel wrote every one of them.
 */
describe('where a saved deck came from', () => {
  it('names the surface in the counts line, and calls a deck with no source Constructed', () => {
    const kept = savedDeckDocument({
      id: 'kept-sealed',
      // Deliberately not a name with `Sealed` in it: the tile has to say where
      // the deck came from whatever it is called, and a name that says it too
      // is an assertion that passes on the name.
      name: 'six packs and a plan',
      savedAt: '2026-09-02T10:00:00.000Z',
      entries: [{ id: FIRST_SPELL, name: 'a card', count: 2 }],
      basics: [{ color: 'U', count: 17 }],
      source: 'sealed',
    });
    const before: SavedDeck = {
      version: 1,
      id: 'kept-old',
      name: 'a deck from before',
      savedAt: '2026-09-01T10:00:00.000Z',
      entries: [{ id: FIRST_SPELL, name: 'a card', count: 4 }],
      basics: null,
    };
    writeSavedDecks([kept, before]);
    openLibrary();

    const sealed = screen.getByRole('button', { name: openDeckLabel(kept.name) });
    expect(textOf(sealed)).toContain(
      deckCountsLine([counted(savedCardCount(kept), 'card'), SAVED_SOURCE_LABELS.sealed]),
    );
    const old = screen.getByRole('button', { name: openDeckLabel(before.name) });
    expect(textOf(old)).toContain(
      deckCountsLine([counted(savedCardCount(before), 'card'), SAVED_SOURCE_LABELS.constructed]),
    );
  });
});
