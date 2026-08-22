// @vitest-environment jsdom
/**
 * What the Cards tab says it is showing, from the fetch inward.
 *
 * The third of `mtg-ihtz`'s three, and the one with no wrong number in it: the
 * gallery drew whatever list `LabApp` had at that instant under a heading that
 * said "Cards" and nothing else. Before the staged set lands that list is the
 * DSL example cards, which is one frame; when the staged document fails to
 * parse it is the example cards for as long as the tab is open, and a person
 * who staged a 249-card set and is scrolling seventeen example cards has no way
 * to find that out from this page.
 *
 * The route-level states are pinned in `../cards.test.ts`. This file is the
 * wire: the set arrives the way `npm run play` delivers it, through `LabApp`'s
 * fetch, so nothing here asserts that a prop was passed.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { LabApp } from '../../src/dev/LabApp';
import { CARDS_LOADING_TITLE, CARDS_UNREADABLE_TITLE } from '../../src/routes/CardsRoute';
import { hashSource } from '../../src/app/router';

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

const SET_DOCUMENT: unknown = JSON.parse(readFileSync(SET_FIXTURE, 'utf8'));
const SET_NAME = 'Tideglass Reach';

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

function setHash(hash: string): void {
  const source = hashSource();
  if (source === null) throw new Error('this test needs a browser location');
  source.location.hash = hash;
}

function openCards(): void {
  setHash('#/cards');
  render(h(LabApp, { replayUrl: 'missing.jsonl', setUrl: 'set.json', cards: EXAMPLE_CARDS }));
}

/**
 * The tab itself, not the shell around it.
 *
 * The shell title already names the staged set, and it named it while this tab
 * drew another set's cards under "Cards" — a heading beside a title is not the
 * same claim as a heading over a gallery. So every assertion here is scoped to
 * the page, or it would pass on the chrome.
 */
function page(): ReturnType<typeof within> {
  return within(screen.getByRole('main'));
}

describe('the Cards tab names the set it is drawing', () => {
  it('shows no gallery on the first render, then the staged set by name', async () => {
    stubFetch({ 'set.json': SET_DOCUMENT });
    openCards();

    // Synchronously, before the fetch resolves: the example cards used to be on
    // screen here, indistinguishable from a set.
    expect(page().getByText(CARDS_LOADING_TITLE)).toBeTruthy();
    expect(page().queryByText('Skywatch Sentinel')).toBeNull();

    await waitFor(() => {
      expect(page().getByText(SET_NAME)).toBeTruthy();
    });
    expect(page().getByText('Saltshrine Acolyte')).toBeTruthy();
  });

  it('says the gallery is the example cards when nothing is staged', async () => {
    stubFetch({});
    openCards();

    await waitFor(() => {
      expect(page().getByText(/DSL example cards/)).toBeTruthy();
    });
    expect(page().getByText('Skywatch Sentinel')).toBeTruthy();
  });

  it('draws no example cards under a staged set that could not be read', async () => {
    stubFetch({ 'set.json': { cards: [{ id: 'not-a-card' }] } });
    openCards();

    await waitFor(() => {
      expect(page().getByText(CARDS_UNREADABLE_TITLE)).toBeTruthy();
    });
    expect(page().queryByText('Skywatch Sentinel')).toBeNull();
    expect(page().queryByText(SET_NAME)).toBeNull();
  });
});
