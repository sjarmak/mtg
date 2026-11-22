// @vitest-environment jsdom
/**
 * Choosing a set on the page, from the index the launcher wrote inward.
 *
 * The lab used to be one set per server restart: `main.ts` fetched a fixed
 * `set.json` and the launcher decided months earlier which set that would be.
 * What this file holds is that the choice reaches the *content* and not only the
 * control — switching has to change what the Cards tab draws, because a picker
 * that changes a label over the same cards is the more convincing version of the
 * bug it was built to fix.
 *
 * The documents are cut from a committed fixture rather than written by hand,
 * because `LabApp` runs every card through `parseCard` before it will call a
 * document a set; the two slices are disjoint so a card on screen names exactly
 * one of them.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { ART_PENDING_LABEL } from '../../src/card/ArtSlot';
import { LabApp } from '../../src/dev/LabApp';
import { SET_PICKER_LABEL, SetPicker, setOptionLabel } from '../../src/app/SetPicker';
import { SET_INDEX_URL, readSetIndex, selectedRow } from '../../src/lab/set-index';
import { SET_INDEX_VERSION } from '../../src/lab/set-index';
import type { SetIndex, StagedSetRow } from '../../src/lab/set-index';
import { hashSource } from '../../src/app/router';
import { deckViewStoreKey } from '../../src/routes/deck/view-mode';
import { LOADING_TITLE, PRECON_MISMATCH_TITLE } from '../../src/routes/PlayRoute';
import { PLAY_SEALED_LABEL } from '../../src/routes/play/SealedChooser';
import { SOURCE_CHOICE_LABEL } from '../../src/routes/play/SourceChoice';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** `path.join` rather than `new URL(…, import.meta.url)`: see `staged-play.test.ts`. */
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

const COMPLETE = JSON.parse(readFileSync(SET_FIXTURE, 'utf8')) as {
  readonly cards: readonly { readonly name: string; readonly id?: string }[];
};

const ALPHA_CARDS = COMPLETE.cards.slice(0, 10);
const BETA_CARDS = COMPLETE.cards.slice(10, 20);

/** A name off the fixture rather than typed here, so a renamed card cannot rot this file. */
function firstName(cards: readonly { readonly name: string }[]): string {
  const card = cards[0];
  if (card === undefined) throw new Error('this test needs a fixture with cards in it');
  return card.name;
}

const ALPHA_CARD = firstName(ALPHA_CARDS);
const BETA_CARD = firstName(BETA_CARDS);

function document(name: string, cards: readonly unknown[]): unknown {
  return { set: { code: name.slice(0, 3).toUpperCase(), name }, cards };
}

function row(overrides: Partial<StagedSetRow> & Pick<StagedSetRow, 'stem'>): StagedSetRow {
  return {
    name: `${overrides.stem} set`,
    code: overrides.stem.toUpperCase(),
    what: 'a build on this disk',
    cardCount: 10,
    reduced: false,
    origin: 'custom',
    setUrl: `sets/${overrides.stem}/set.json`,
    ...overrides,
  };
}

/** The name of the one deck the staged precon file below describes. */
const DECK_NAME = 'Alpha Aggro';

/**
 * A precon document over a set's own cards.
 *
 * Written from the cards rather than typed, so it stays a file that resolves
 * against the set it names: the whole point of the test that reads it is that
 * this file is *fine* until it is measured against a different set.
 */
function precons(setCode: string, cards: readonly { readonly id?: string }[]): unknown {
  // Nine cards, four copies each, twenty-four basics: the builder measures the
  // list's own curve and refuses a deck whose spells and lands do not add up to
  // `deckSize`, so the arithmetic is the fixture rather than an afterthought.
  const spells = cards
    .slice(0, 9)
    .flatMap((card) => (card.id === undefined ? [] : [{ id: card.id, count: 4 }]));
  const first = spells[0];
  if (spells.length < 9 || first === undefined) {
    throw new Error('this test needs a fixture with nine cards that carry ids');
  }
  return {
    formatVersion: 1,
    setCode,
    decks: [
      {
        id: 'alpha-aggro',
        name: DECK_NAME,
        plan: 'Play the cheap ones and attack with them.',
        payoff: first.id,
        deckSize: 60,
        basics: { W: 24 },
        spells,
      },
    ],
  };
}

/** A structural `querySelectorAll`, since the workspace typechecks without `lib: dom`. */
function query(node: unknown, selector: string): unknown[] {
  return [...(node as { querySelectorAll(selector: string): Iterable<unknown> }).querySelectorAll(selector)];
}

function attr(node: unknown, name: string): string | null {
  return (node as { getAttribute(name: string): string | null }).getAttribute(name);
}

function index(rows: readonly StagedSetRow[], selected: string): SetIndex {
  return { formatVersion: SET_INDEX_VERSION, selected, sets: [...rows] };
}

function stubFetch(routes: Readonly<Record<string, unknown>>): void {
  vi.stubGlobal('fetch', (url: string) => {
    const body = routes[url];
    if (body === undefined) {
      return Promise.resolve({
        ok: false,
        status: 404,
        headers: { get: () => null },
        json: () => Promise.resolve(null),
        text: () => Promise.resolve(''),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name === 'content-type' ? 'application/json' : null) },
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  });
}

/**
 * A dev server answering a missing file the way Vite does.
 *
 * `vite dev` serves `index.html` for anything it cannot find under `public/`, so
 * a page with no staged index gets a 200 with an HTML body rather than a 404.
 * Reading the status alone would call that a broken index and say so to somebody
 * who has never staged anything.
 */
function stubHtmlFallback(): void {
  vi.stubGlobal('fetch', () =>
    Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      json: () => Promise.reject(new Error('not json')),
      text: () => Promise.resolve('<!doctype html>'),
    }),
  );
}

function setHash(hash: string): void {
  const source = hashSource();
  if (source === null) throw new Error('this test needs a browser location');
  source.location.hash = hash;
}

function page(): ReturnType<typeof within> {
  return within(screen.getByRole('main'));
}

const TWO_SETS: Readonly<Record<string, unknown>> = {
  [SET_INDEX_URL]: index(
    [row({ stem: 'alpha', preconUrl: 'sets/alpha/precons.json' }), row({ stem: 'beta' })],
    'alpha',
  ),
  'sets/alpha/set.json': document('Alpha Reach', ALPHA_CARDS),
  'sets/beta/set.json': document('Beta Reach', BETA_CARDS),
};

function openCards(): void {
  setHash('#/cards');
  render(h(LabApp, { setUrl: 'set.json', setIndexUrl: SET_INDEX_URL, cards: EXAMPLE_CARDS }));
}

describe('reading the index the launcher staged', () => {
  it('accepts what the launcher writes', () => {
    const read = readSetIndex(index([row({ stem: 'alpha' }), row({ stem: 'beta' })], 'beta'), 'index.json');
    expect(read.ok).toBe(true);
  });

  it('refuses two rows that share a stem, which is a set the picker would hide', () => {
    const read = readSetIndex(index([row({ stem: 'alpha' }), row({ stem: 'alpha' })], 'alpha'), 'index.json');
    expect(read.ok).toBe(false);
    if (read.ok) throw new Error('unreachable');
    expect(read.message).toContain('two staged sets share the stem alpha');
  });

  it('refuses a default that names no row, rather than opening on nothing', () => {
    const read = readSetIndex(index([row({ stem: 'alpha' })], 'gamma'), 'index.json');
    expect(read.ok).toBe(false);
    if (read.ok) throw new Error('unreachable');
    expect(read.message).toContain('selected names gamma');
  });

  it('names the file and the command in the message, since the reader is a person', () => {
    const read = readSetIndex({ formatVersion: 9, selected: 'alpha', sets: [] }, 'sets/index.json');
    if (read.ok) throw new Error('unreachable');
    expect(read.message).toContain('sets/index.json');
    expect(read.message).toContain('npm run play');
  });

  it('falls back to the default for a stem the index no longer lists', () => {
    // The state a page left open across a staging run arrives in: the set on
    // screen is gone and the alternative is a blank page.
    const parsed = index([row({ stem: 'alpha' }), row({ stem: 'beta' })], 'beta');
    expect(selectedRow(parsed, 'alpha').stem).toBe('alpha');
    expect(selectedRow(parsed, 'gone').stem).toBe('beta');
    expect(selectedRow(parsed, null).stem).toBe('beta');
  });
});

describe('the picker itself', () => {
  it('draws a label rather than a dropdown for one staged set', () => {
    render(
      h(SetPicker, {
        sets: [row({ stem: 'alpha', name: 'Alpha Reach' })],
        selected: 'alpha',
        onSelect: () => {},
      }),
    );
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('Alpha Reach')).toBeTruthy();
    expect(screen.getByText(SET_PICKER_LABEL)).toBeTruthy();
  });

  it('draws nothing at all when nothing is staged', () => {
    render(h(SetPicker, { sets: [], selected: 'alpha', onSelect: () => {} }));
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText(SET_PICKER_LABEL)).toBeNull();
  });

  it('reads as the set’s name alone, which is what a closed select draws', () => {
    // A native select draws the selected option's own text when it is closed, so
    // the option label is the closed state. It used to read
    // `the flagship set — 371 cards, the committed fixture`, which made the
    // widest thing in the header a sentence about a build directory.
    const only = row({ stem: 'xmp', name: 'the flagship set', cardCount: 371 });
    expect(setOptionLabel(only, [only])).toBe('the flagship set');
  });

  it('drops the (reduced) the document appends, which the notice already says', () => {
    const partial = row({ stem: 'm11', name: 'Magic 2011 (reduced)', reduced: true, origin: 'official' });
    expect(setOptionLabel(partial, [partial])).toBe('Magic 2011');
  });

  it('separates two builds of one set by their count, and only then', () => {
    // The case the longer label existed for: two candidates that call themselves
    // the same thing, which is what `out/` and the committed fixture produce
    // daily. What no longer rides along is where the build came from — a path a
    // person cannot act on — so the count is the whole disambiguation.
    const paid = row({
      stem: 'xmp',
      name: 'Same Name',
      cardCount: 249,
      what: 'the generation run in out/XMP',
    });
    const fixture = row({ stem: 'xmp-2', name: 'Same Name', cardCount: 371, what: 'the committed fixture' });
    const both = [paid, fixture];
    expect(setOptionLabel(paid, both)).not.toBe(setOptionLabel(fixture, both));
    expect(setOptionLabel(paid, both)).toContain('249 cards');
    expect(setOptionLabel(fixture, both)).not.toContain('the committed fixture');
  });

  it('names a printed row’s kind rather than its stem when it collides with a kernel build', () => {
    const printed = { stem: 'printed:rtr', name: 'Return to Ravnica', origin: 'official' as const };
    const kernel = row({ stem: 'rtr-274', name: 'Return to Ravnica', cardCount: 274, origin: 'official' });
    const both = [printed, kernel];
    expect(setOptionLabel(printed, both)).toBe('Return to Ravnica — Magic set');
    expect(setOptionLabel(kernel, both)).toBe('Return to Ravnica — 274 cards');
    expect(setOptionLabel(printed, both)).not.toContain('printed:');
  });

  it('files each option under Custom or Magic, using the platform’s own headings', () => {
    // `mtg-tewc.2`. An `<optgroup>` rather than a drawn heading: it costs the
    // closed control no height, which is the whole reason this form of the
    // choice exists, and on a phone it is the system sheet that draws it.
    render(
      h(SetPicker, {
        sets: [
          row({ stem: 'xmp', name: 'the flagship set' }),
          row({ stem: 'm11', name: 'Magic 2011 (reduced)', reduced: true, origin: 'official' }),
        ],
        selected: 'xmp',
        onSelect: () => {},
      }),
    );
    // No `lib: dom` in this workspace, so the tree is walked structurally, the
    // way `../board-marks.test.ts` walks it.
    const groups = query(screen.getByLabelText(SET_PICKER_LABEL), 'optgroup');
    expect(groups.map((group) => attr(group, 'label'))).toEqual(['Custom', 'Magic']);
    expect(groups.map((group) => query(group, 'option').length)).toEqual([1, 1]);
  });
});

describe('switching sets on the page', () => {
  it('offers every staged set and opens on the launcher’s choice', async () => {
    stubFetch(TWO_SETS);
    openCards();

    await waitFor(() => {
      expect(page().getByText('Alpha Reach')).toBeTruthy();
    });
    const picker = screen.getByLabelText(SET_PICKER_LABEL);
    expect(within(picker as unknown as HTMLElement).getAllByRole('option')).toHaveLength(2);
    expect((picker as unknown as { value: string }).value).toBe('alpha');
  });

  /**
   * `mtg-a982g.5`. One dropdown over every tab could only be right for one Play
   * section at a time: Draft has the cube in it, Sealed does not, and Commander
   * has none of the staged sets and lists printed decks instead. So Play draws
   * the choice in the section, out of what that section can actually deal
   * (`../../src/routes/play/SourceChoice.ts`), and the browsing tabs keep the
   * one control that says which set they are showing.
   */
  it('draws no picker on Play, where the section chooses its own set, and keeps it on Cards', async () => {
    stubFetch(TWO_SETS);
    setHash('#/play/sealed');
    render(h(LabApp, { setUrl: 'set.json', setIndexUrl: SET_INDEX_URL, cards: EXAMPLE_CARDS }));

    // Neither slice of the fixture fills a booster, so the section says why
    // where its button would go; the point here is that the chips are the
    // control that is drawn and the header picker is not.
    await screen.findByRole('group', { name: SOURCE_CHOICE_LABEL });
    expect(screen.getByRole('region', { name: PLAY_SEALED_LABEL })).toBeTruthy();
    // Both controls answer the same question and are named for it, so each is
    // asked for by what it is: a dropdown in the bar, chips on the page.
    expect(screen.queryByRole('combobox', { name: SET_PICKER_LABEL })).toBeNull();

    fireEvent.click(screen.getAllByRole('link', { name: 'Cards' })[0]!);
    await screen.findByRole('combobox', { name: SET_PICKER_LABEL });
    expect(screen.queryByRole('group', { name: SOURCE_CHOICE_LABEL })).toBeNull();
  });

  it('changes what the Cards tab draws, not only what the bar says', async () => {
    stubFetch(TWO_SETS);
    openCards();

    await waitFor(() => {
      expect(page().getByText(ALPHA_CARD)).toBeTruthy();
    });
    expect(page().queryByText(BETA_CARD)).toBeNull();

    fireEvent.change(screen.getByLabelText(SET_PICKER_LABEL), { target: { value: 'beta' } });

    await waitFor(() => {
      expect(page().getByText(BETA_CARD)).toBeTruthy();
    });
    expect(page().queryByText(ALPHA_CARD)).toBeNull();
    expect(page().getByText('Beta Reach')).toBeTruthy();
  });

  /**
   * `mtg-aqxi.13`. Selecting a set that stages no decks left the *previous*
   * set's decks standing, and the play route measured them against the new
   * set's cards and printed every id it could not find. That is the shape a
   * reader met: choosing Magic 2013 answered with a paragraph of `xmp-` ids
   * across the top of the page, as if their launcher had staged something
   * broken.
   *
   * The cause was one line in each of `LabApp`'s four document hooks — a url
   * that goes from a string to `undefined` returned early instead of clearing —
   * and the `useState` that maps `undefined` to `absent` runs at mount only.
   * Only the precon arm is reachable from today's index, since every row
   * carries a set and an art url; the other three are fixed with it because
   * they are the same line.
   *
   * Asserted through the page rather than the hook: the bug was invisible in
   * the state and loud on the screen.
   */
  it('drops the previous set’s decks when the set arriving stages none', async () => {
    stubFetch({
      ...TWO_SETS,
      'sets/alpha/precons.json': precons('ALP', ALPHA_CARDS),
    });
    setHash('#/play');
    render(h(LabApp, { setUrl: 'set.json', setIndexUrl: SET_INDEX_URL, cards: EXAMPLE_CARDS }));

    // Alpha stages decks, so the page offers them and says nothing about a
    // mismatch: the file names alpha's own cards.
    await waitFor(() => {
      // All of them: the deck names its tile, the opponent picker and the line
      // saying which deck you are playing.
      expect(page().getAllByText(DECK_NAME).length).toBeGreaterThan(0);
    });
    expect(page().queryByText(new RegExp(PRECON_MISMATCH_TITLE))).toBeNull();

    // The chips above the landing rather than the header's picker, which Play
    // no longer draws: the section chooses its own set (`mtg-a982g.5`).
    fireEvent.click(screen.getByRole('button', { name: 'beta set' }));

    // Waited on the *set*, not on the decks. Beta's cards take a tick to
    // arrive, and while the route says `LOADING_TITLE` it draws no decks and no
    // notes — so an assertion taken here would pass over the bug rather than on
    // the fix.
    await waitFor(() => {
      expect(page().queryByText(LOADING_TITLE)).toBeNull();
    });
    expect(page().queryAllByText(DECK_NAME)).toHaveLength(0);
    expect(page().queryByText(new RegExp(PRECON_MISMATCH_TITLE))).toBeNull();
    expect(page().queryByText(new RegExp(ALPHA_CARD))).toBeNull();
  });

  it('draws no picker and keeps the flat set when a dev server answers the index with its index.html', async () => {
    // 200 with an HTML body, which is `vite dev` on a checkout that has never
    // staged anything. The page has to read that as "no index", not "broken".
    stubHtmlFallback();
    openCards();

    await waitFor(() => {
      expect(page().getByText(/DSL example cards/)).toBeTruthy();
    });
    expect(screen.queryByLabelText(SET_PICKER_LABEL)).toBeNull();
    // Scoped to the chrome: the Cards tab has filter dropdowns of its own, so an
    // unscoped combobox query would fail on the page rather than on the picker.
    expect(within(screen.getByRole('banner')).queryByRole('combobox')).toBeNull();
  });
});

/**
 * What switching sets must *not* change: the game already being played.
 *
 * A table and a room are dealt by the launcher's own server, from the set the
 * launcher opened, before a single bundle is staged (`tools/play.ts` builds all
 * three dealers from its resolved set). So the picker moves what this tab
 * browses and moves nothing about what is on the far end of a seat link, and
 * anything the room's screens read off the browsed set is read off the wrong
 * one.
 *
 * `mtg-77i6` settled the cards that way round: the room serves the set its own
 * pool is printed in. This is the same sentence about the pictures. The art
 * manifest is keyed by card id, so the browsed set's manifest over the room's
 * pool resolves nothing and every card in a LAN game wore the labeled pending
 * frame on whichever side had switched sets (`mtg-5h78`).
 */
/**
 * `mtg-ahr5`. The statistics log and the recorded event log are staged once, for
 * the set the launcher opened, and the picker moves what the page shows without
 * moving either of them. Withholding them is right — replaying one set's
 * decisions over another set's cards would be a worse failure than a blank page
 * — and withholding them silently is not: a checkout that has never recorded a
 * game and a lab one picker move away from its own recording drew the same page,
 * and only one of them has anything to act on.
 */
describe('the logs the picker leaves behind', () => {
  /** The whole empty state as one string: `renderCopy` splits it into spans. */
  function block(title: unknown): string {
    const parent = (title as { parentElement: { textContent: string | null } | null }).parentElement;
    if (parent === null) throw new Error('the empty state drew no block');
    return parent.textContent ?? '';
  }

  it('says which set the recording is of, once the picker has moved off it', async () => {
    stubFetch(TWO_SETS);
    setHash('#/replay');
    render(
      h(LabApp, {
        setUrl: 'set.json',
        setIndexUrl: SET_INDEX_URL,
        cards: EXAMPLE_CARDS,
        eventLogUrl: 'replay.events.jsonl',
      }),
    );

    // Alpha is the launcher's set and this checkout staged no log, so the tab
    // says exactly that: nothing recorded, and the command that records one.
    await waitFor(() => {
      expect(screen.getByText('No replay recorded yet')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText(SET_PICKER_LABEL), { target: { value: 'beta' } });

    await waitFor(() => {
      expect(screen.getByText('The recorded game is of another set')).toBeTruthy();
    });
    // The index row's own name, which is what the picker offers and what the
    // sentence has to use: the document inside the bundle calls itself something
    // else, and naming a set two ways on one screen is how a reader loses track
    // of which one they moved off.
    const said = block(screen.getByText('The recorded game is of another set'));
    expect(said).toContain('alpha set');
    expect(said).toContain('beta set');
    expect(screen.queryByText('No replay recorded yet')).toBeNull();
  });

  it('keeps saying nothing was recorded when no log is staged at all', async () => {
    // The sentence is about a log that exists and is another set's. A lab with
    // no `eventLogUrl` has no recording to be elsewhere.
    stubFetch(TWO_SETS);
    setHash('#/replay');
    render(h(LabApp, { setUrl: 'set.json', setIndexUrl: SET_INDEX_URL, cards: EXAMPLE_CARDS }));

    await waitFor(() => {
      expect(screen.getByText('No replay recorded yet')).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText(SET_PICKER_LABEL), { target: { value: 'beta' } });
    await waitFor(() => {
      expect((screen.getByLabelText(SET_PICKER_LABEL) as unknown as { value: string }).value).toBe('beta');
    });
    expect(screen.getByText('No replay recorded yet')).toBeTruthy();
    expect(screen.queryByText('The recorded game is of another set')).toBeNull();
  });
});

describe('a room is not the set this tab is browsing', () => {
  const ROOM_TOKEN = 'token-one';

  /** A format-2 manifest over a set's own cards, each picture named after it. */
  function manifest(
    prefix: string,
    cards: readonly { readonly id?: string; readonly name: string }[],
  ): unknown {
    return {
      formatVersion: 2,
      art: Object.fromEntries(
        cards.flatMap((card) =>
          card.id === undefined
            ? []
            : [[card.id, [{ href: `${prefix}/${card.id}.png`, alt: `${prefix} ${card.name}` }]]],
        ),
      ),
    };
  }

  /** The room as the server sends one: a pool of ids, in the alpha set. */
  const ROOM = {
    protocol: 3,
    room: 'room-1',
    phase: 'build',
    seat: 0,
    seats: [
      { name: 'You', ready: false },
      { name: 'Sam', ready: false },
    ],
    revision: 0,
    pool: ALPHA_CARDS.flatMap((card) => (card.id === undefined ? [] : [card.id])),
    deckSize: 40,
  };

  const ROUTES: Readonly<Record<string, unknown>> = {
    [SET_INDEX_URL]: index(
      [
        row({ stem: 'alpha', artUrl: 'sets/alpha/art.json' }),
        row({ stem: 'beta', artUrl: 'sets/beta/art.json' }),
      ],
      'alpha',
    ),
    'sets/alpha/set.json': document('Alpha Reach', ALPHA_CARDS),
    'sets/beta/set.json': document('Beta Reach', BETA_CARDS),
    'sets/alpha/art.json': manifest('alpha-art', ALPHA_CARDS),
    'sets/beta/art.json': manifest('beta-art', BETA_CARDS),
    [`/api/room/${ROOM_TOKEN}`]: ROOM,
    [`/api/room/${ROOM_TOKEN}/set`]: { protocol: 3, cards: ALPHA_CARDS },
  };

  function srcOf(node: unknown): string {
    return attr(node, 'src') ?? '';
  }

  /**
   * `stubFetch` with a note of what was asked for.
   *
   * The room's screens say nothing about which set this tab is browsing — that
   * is the whole point of them — so the switch has to be observed somewhere
   * else, and the browsed set's own manifest going out is the observation.
   */
  function stubRecordingFetch(routes: Readonly<Record<string, unknown>>): readonly string[] {
    const asked: string[] = [];
    stubFetch(routes);
    const inner = globalThis.fetch;
    vi.stubGlobal('fetch', (url: string, init?: unknown) => {
      asked.push(url);
      return (inner as (url: string, init?: unknown) => Promise<Response>)(url, init);
    });
    return asked;
  }

  /**
   * Both sealed panes in full cards, so their tiles draw illustrations at all.
   *
   * A pane opens in compact since `mtg-ljda`, and a compact tile drops the art
   * window (`../../src/card/anatomy.ts`). These tests are about *which* set's pictures
   * reach the screen, so they ask for the mode that has pictures rather than
   * measuring whichever mode is the default.
   */
  function fullSealedPanes(): void {
    const host = globalThis as { readonly localStorage?: { setItem(key: string, value: string): void } };
    const kept = host.localStorage;
    if (kept === undefined) throw new Error('no preference store');
    for (const pane of ['limited-deck', 'limited-pool']) kept.setItem(deckViewStoreKey(pane), 'full');
  }

  it('keeps drawing the dealt set’s art after the browsed set moves to another one', async () => {
    fullSealedPanes();
    const asked = stubRecordingFetch(ROUTES);
    setHash(`#/play?room=${ROOM_TOKEN}`);
    render(h(LabApp, { setUrl: 'set.json', setIndexUrl: SET_INDEX_URL, cards: EXAMPLE_CARDS }));

    await waitFor(() => {
      expect(screen.getAllByRole('img', { name: /^alpha-art / }).length).toBeGreaterThan(0);
    });

    // Through the hash rather than a control. A seat in a room is the page
    // (`../../src/dev/section-views.ts`), so there is no picker and no chip on
    // it to press; what there still is, is a link somebody kept, and that is
    // the state this test is about.
    setHash(`#/play?room=${ROOM_TOKEN}&source=beta`);

    // The pool is unchanged, because the room dealt it; so is every picture over
    // it, because the room's set is what prints them. Beta's manifest knows none
    // of these ids, so reading it here draws the pending frame on all of them.
    await waitFor(() => {
      expect(asked).toContain('sets/beta/art.json');
    });
    const drawn = screen.getAllByRole('img', { name: /^alpha-art / }).map((image) => srcOf(image));
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every((src) => src.startsWith('alpha-art/'))).toBe(true);
    expect(screen.queryAllByLabelText(new RegExp(`^${ART_PENDING_LABEL} for `))).toEqual([]);
  });
});
