// @vitest-environment jsdom
/**
 * What a reduced build left out, on the page and under the same search.
 *
 * `mtg-f1b0`: `npm run reference:reduced` names every position it refused and
 * why, on stdout, and then writes a set that renders like any other set. The
 * shell already discloses *that* the build is partial (`reduced-notice.test.ts`
 * owns that half); this file owns the list — that the refusals are drawn at all,
 * that the Cards route's own search box narrows them, and that an ordinary set
 * grows no such control.
 *
 * The document is synthetic for the reason the sibling file's is: what is under
 * test is the wire from the staged block to the page, and the real M13's 68
 * refusals are checked where they are produced.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { LabApp } from '../../src/dev/LabApp';
import { CARDS_SEARCH_LABEL } from '../../src/routes/CardsRoute';
import { hashSource } from '../../src/app/router';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

const COMPLETE = JSON.parse(readFileSync(SET_FIXTURE, 'utf8')) as { readonly cards: readonly unknown[] };

/** Three refusals in the shape `@mtg/data`'s emitter writes them. */
const DROPS = [
  {
    collectorNumber: 1,
    name: 'Ajani, Caller of the Pride',
    rarity: 'mythic',
    colors: ['W'],
    code: 'MISSING_POSITION',
    reason: 'position 1 has no coverage row',
    refusal: {
      code: 'MISSING_EVIDENCE',
      detail: 'refused by reference-planeswalker-audit',
      missing: ['temporary-double-strike'],
    },
  },
  {
    collectorNumber: 7,
    name: 'Fauna Shaman',
    rarity: 'rare',
    colors: ['G'],
    code: 'MISSING_POSITION',
    reason: 'position 7 has no coverage row',
    refusal: { code: 'NO_VOCABULARY', detail: 'an activation cost cannot say which card it discards' },
  },
  {
    collectorNumber: 9,
    name: 'Cultivate',
    rarity: 'common',
    colors: ['G'],
    code: 'MISSING_POSITION',
    reason: 'position 9 has no coverage row',
    refusal: { code: 'NO_VOCABULARY', detail: 'a library search has one destination' },
  },
] as const;

function reduction(drops: readonly unknown[]): Record<string, unknown> {
  return {
    source: {
      code: 'RDX',
      name: 'a pinned reference printing',
      releaseDate: '2010-07-15',
      sourceSha256: 'a'.repeat(64),
      mainSetPositions: 20 + drops.length,
    },
    kept: 20,
    dropped: drops.length,
    census: { kept: { positions: 20, byRarity: [] }, dropped: { positions: drops.length, byRarity: [] } },
    collation: { fillsAPack: true, sheets: [], emptiedSheets: [], boosters: [], unfillableBoosters: 0 },
    drops,
  };
}

function reducedDocument(drops: readonly unknown[] = DROPS): unknown {
  return {
    formatVersion: 1,
    kind: 'position-reduced-reference-set-document',
    set: { code: 'RDX', name: 'a pinned reference printing (reduced)', reduced: true },
    reduction: reduction(drops),
    cards: COMPLETE.cards.slice(0, 20),
  };
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

function openCards(document: unknown, hash = '#/cards'): void {
  stubFetch({ 'set.json': document });
  const source = hashSource();
  if (source === null) throw new Error('this test needs a browser location');
  source.location.hash = hash;
  render(h(LabApp, { setUrl: 'set.json', cards: EXAMPLE_CARDS }));
}

describe('the refused positions on the Cards route', () => {
  it('lists every refusal with the reason the emitter recorded', async () => {
    openCards(reducedDocument());

    await waitFor(() =>
      expect(
        screen.getByText('3 cards a pinned reference printing prints that this build does not'),
      ).toBeTruthy(),
    );
    expect(screen.getByText('1. Ajani, Caller of the Pride')).toBeTruthy();
    expect(screen.getByText('7. Fauna Shaman')).toBeTruthy();
    // The identity-level refusal, not the position-level "no coverage row" that
    // every drop carries and that tells a reader nothing.
    expect(screen.getByText(/refused by reference-planeswalker-audit/)).toBeTruthy();
    expect(screen.getByText(/an activation cost cannot say which card it discards/)).toBeTruthy();
  });

  it('narrows the list with the same search box that narrows the gallery', async () => {
    openCards(reducedDocument());
    const search = await waitFor(() => screen.getByLabelText(CARDS_SEARCH_LABEL));

    fireEvent.change(search, { target: { value: 'ajani' } });

    expect(
      screen.getByText('1 of 3 shown, narrowed by the search box and the rarity filter above.'),
    ).toBeTruthy();
    expect(screen.getByText('1. Ajani, Caller of the Pride')).toBeTruthy();
    expect(screen.queryByText('7. Fauna Shaman')).toBeNull();
  });

  it('says so rather than emptying silently when nothing refused matches', async () => {
    openCards(reducedDocument());
    const search = await waitFor(() => screen.getByLabelText(CARDS_SEARCH_LABEL));

    fireEvent.change(search, { target: { value: 'no card is called this' } });

    expect(screen.getByText('No refused card matches that.')).toBeTruthy();
  });

  it('narrows by the rarity filter, which a drop is one of the two things it carries', async () => {
    openCards(reducedDocument(), '#/cards?rarity=common');

    await waitFor(() => expect(screen.getByText('9. Cultivate')).toBeTruthy());
    expect(
      screen.getByText('1 of 3 shown, narrowed by the search box and the rarity filter above.'),
    ).toBeTruthy();
    expect(screen.queryByText('1. Ajani, Caller of the Pride')).toBeNull();
  });

  it('draws nothing for a reduced build that refused nothing, and none for an ordinary set', async () => {
    openCards(reducedDocument([]));

    await waitFor(() => expect(screen.getByLabelText(CARDS_SEARCH_LABEL)).toBeTruthy());
    expect(screen.queryByText(/prints that this build does not/)).toBeNull();

    cleanup();
    openCards(COMPLETE);
    await waitFor(() => expect(screen.getByLabelText(CARDS_SEARCH_LABEL)).toBeTruthy());
    expect(screen.queryByText(/prints that this build does not/)).toBeNull();
  });
});
