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
import { LabApp } from '../../src/dev/LabApp';
import { SET_PICKER_LABEL, SetPicker, setOptionLabel } from '../../src/app/SetPicker';
import { SET_INDEX_URL, readSetIndex, selectedRow } from '../../src/lab/set-index';
import type { SetIndex, StagedSetRow } from '../../src/lab/set-index';
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

const COMPLETE = JSON.parse(readFileSync(SET_FIXTURE, 'utf8')) as {
  readonly cards: readonly { readonly name: string }[];
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
    setUrl: `sets/${overrides.stem}/set.json`,
    ...overrides,
  };
}

function index(rows: readonly StagedSetRow[], selected: string): SetIndex {
  return { formatVersion: 1, selected, sets: [...rows] };
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
  [SET_INDEX_URL]: index([row({ stem: 'alpha' }), row({ stem: 'beta' })], 'alpha'),
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

  it('separates two builds of one set by their count and their origin', () => {
    // The case the label exists for: two candidates that call themselves the
    // same thing, which is what `out/` and the committed fixture produce daily.
    const paid = row({
      stem: 'xmp',
      name: 'Same Name',
      cardCount: 249,
      what: 'the generation run in out/XMP',
    });
    const fixture = row({ stem: 'xmp-2', name: 'Same Name', cardCount: 371, what: 'the committed fixture' });
    expect(setOptionLabel(paid)).not.toBe(setOptionLabel(fixture));
    expect(setOptionLabel(paid)).toContain('249 cards');
    expect(setOptionLabel(fixture)).toContain('the committed fixture');
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
