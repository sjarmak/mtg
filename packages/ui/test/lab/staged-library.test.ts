// @vitest-environment jsdom
/**
 * The Cards tab reads every staged bundle, not only the one the header names.
 *
 * `mtg-tewc.8`, the wiring half. `../cards-library.test.ts` pins what the route
 * does with a library it was handed; this file is the fetch that produces one,
 * so nothing here asserts that a prop was passed.
 *
 * The library is read when the Cards tab is open and not before, which is the
 * cost the bead asked to watch: three staged sets is 371 + 162 + 145 cards, and
 * a lab opened on Play has no reason to have parsed any of the two it is not
 * playing. The Draft tab still reads the selected bundle alone.
 *
 * `mtg-pxdo` added one exception and bounded it. The Play tab offers the decks
 * the workbench built, and those are not cut from the set the header names —
 * Vessari-v3 states four staged sets and its lands are M11 printings — so it does
 * need the others *when there are such decks*. Whether there are is one cheap
 * request to the deck server, asked before any set is fetched, and `npm run
 * play` alone serves no deck server. Both halves are pinned below.
 */
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { LabApp } from '../../src/dev/LabApp';
import { CARDS_SEARCH_LABEL, CARDS_SET_LABEL } from '../../src/routes/CardsRoute';
import { SET_INDEX_VERSION } from '../../src/lab/set-index';
import { hashSource } from '../../src/app/router';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setDocument(code: string, name: string, cardName: string): unknown {
  return {
    set: { code, name, ...(code === 'M11' ? { reduced: true } : {}) },
    cards: [
      {
        id: `${code.toLowerCase()}-one`,
        name: cardName,
        kind: 'creature',
        rarity: 'common',
        set: { code, collectorNumber: 1 },
        manaCost: { generic: 1, G: 1 },
        colors: ['G'],
        power: 2,
        toughness: 2,
      },
    ],
  };
}

const INDEX = {
  formatVersion: SET_INDEX_VERSION,
  selected: 'xmp',
  sets: [
    {
      stem: 'xmp',
      name: 'the flagship set',
      code: 'XMP',
      what: 'the committed fixture',
      cardCount: 1,
      reduced: false,
      origin: 'custom',
      setUrl: 'sets/xmp/set.json',
    },
    {
      stem: 'm11',
      name: 'Magic 2011 (reduced)',
      code: 'M11',
      what: 'a reduced reference build',
      cardCount: 1,
      reduced: true,
      origin: 'official',
      setUrl: 'sets/m11/set.json',
    },
  ],
};

const ROUTES: Readonly<Record<string, unknown>> = {
  'sets/index.json': INDEX,
  'sets/xmp/set.json': setDocument('XMP', 'the flagship set', 'Silver Direhorn'),
  'sets/m11/set.json': setDocument('M11', 'Magic 2011 (reduced)', 'Runeclaw Bear'),
};

/** What `/deck-api/variations` answers, or nothing at all for no deck server. */
type Shelf = { readonly variations: readonly Record<string, unknown>[] };

/** One shelf row, in full: the client validates the answer and drops a partial one. */
const SHELF_ROW: Record<string, unknown> = {
  id: 'v1',
  name: 'Alaric-v1',
  builtAt: '2026-09-01T10:00:00.000Z',
  parentId: null,
  prompt: 'a mono-white weenie deck around Alaric',
  sets: ['XMP'],
  colors: ['W'],
  totalCards: 60,
  shortfallCount: 0,
};

function stubFetch(seen: string[], shelf?: Shelf): void {
  vi.stubGlobal('fetch', (url: string) => {
    seen.push(url);
    if (url.endsWith('/deck-api/variations')) {
      if (shelf === undefined) return Promise.reject(new Error('connection refused'));
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ ...shelf, unreadable: [] }),
        text: () => Promise.resolve(''),
      });
    }
    const body = ROUTES[url];
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

function open(hash: string, seen: string[], shelf?: Shelf): void {
  const source = hashSource();
  if (source === null) throw new Error('this test needs a browser location');
  source.location.hash = hash;
  stubFetch(seen, shelf);
  render(h(LabApp, { setIndexUrl: 'sets/index.json', cards: EXAMPLE_CARDS }));
}

/** The DOM this workspace can name: no `lib: dom`, so the shape is spelled out. */
interface ElementLike {
  readonly getAttribute: (name: string) => string | null;
}

function page(): ReturnType<typeof within> {
  return within(screen.getByRole('main'));
}

describe('the Cards tab over every staged bundle', () => {
  it('searches across both sets, and offers a filter over them', async () => {
    open('#/cards', []);
    await waitFor(() => {
      expect(page().getByText('Silver Direhorn')).toBeTruthy();
    });
    // The set the header is on, until somebody searches.
    expect(page().queryByText('Runeclaw Bear')).toBeNull();
    fireEvent.change(page().getByLabelText(CARDS_SEARCH_LABEL), { target: { value: 'runeclaw' } });
    await waitFor(() => {
      expect(page().getByText('Runeclaw Bear')).toBeTruthy();
    });
    const select = page().getByLabelText(CARDS_SET_LABEL);
    expect(
      within(select)
        .getAllByRole('group')
        .map((group) => (group as unknown as ElementLike).getAttribute('label')),
    ).toEqual(['Custom', 'Magic']);
  });

  it('reads the set the header names, and no other, until the Cards tab is opened', async () => {
    const seen: string[] = [];
    open('#/play', seen);
    await waitFor(() => {
      expect(seen).toContain('sets/xmp/set.json');
    });
    expect(seen).not.toContain('sets/m11/set.json');
  });

  it('reads every staged set on Play once the deck server offers a built deck', async () => {
    // The one exception, and the reason for it: a built deck may be cut from
    // sets this tab is not showing, so a picker that offered it against the
    // header's set alone would resolve half of it. `mtg-pxdo`.
    const seen: string[] = [];
    open('#/play', seen, { variations: [SHELF_ROW] });
    await waitFor(() => {
      expect(seen).toContain('sets/m11/set.json');
    });
  });

  it('reads no other set on Play when the deck server has nothing to offer', async () => {
    // An empty shelf is a deck server with no decks on it, which is the same
    // answer as no deck server: nothing to resolve, nothing to pay for.
    const seen: string[] = [];
    open('#/play', seen, { variations: [] });
    await waitFor(() => {
      expect(seen).toContain('sets/xmp/set.json');
    });
    expect(seen).not.toContain('sets/m11/set.json');
  });
});
