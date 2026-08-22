// @vitest-environment jsdom
/**
 * A reduced set says so on screen, wherever you opened it.
 *
 * `npm run reference:reduced` stages a set with collector positions missing:
 * every card in it was proved by the kernel, and the ones that were not are
 * absent rather than approximated. On the page that is invisible — a set of a
 * hundred and thirty-four cards renders exactly like a set of two hundred and
 * forty-nine — and the launcher's stdout reaches nobody who was handed the URL
 * of a server somebody else started. So the shell carries the count on every
 * route, the play route included, because that is the route where somebody is
 * about to draw from the pool.
 *
 * The document is synthetic here rather than a real reduced M11: what this file
 * checks is the wire from the staged document to the chrome, and the counts a
 * real M11 has are checked where they are produced, beside the materializer.
 * The card list is a real fixture because `LabApp` runs every card through
 * `parseCard` before it will call a document a set.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { EXAMPLE_CARDS } from '@mtg/dsl';
import { LabApp } from '../../src/dev/LabApp';
import { SHELL_NOTICE_LABEL } from '../../src/app/Shell';
import { readReduction, reducedNoticeText } from '../../src/lab/reduced-notice';
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

const COMPLETE = JSON.parse(readFileSync(SET_FIXTURE, 'utf8')) as { readonly cards: readonly unknown[] };

/** A sheet's card-to-weight map, as deep as the sheet says it is. */
function sheetWeights(cards: number): Record<string, number> {
  return Object.fromEntries(Array.from({ length: cards }, (_, index) => [`rdx-${String(index + 1)}`, 1]));
}

/** A reduction block in the shape `@mtg/data`'s emitter writes it. */
function reduction(kept: number, dropped: number): Record<string, unknown> {
  return {
    source: {
      code: 'RDX',
      name: 'a pinned reference printing',
      releaseDate: '2010-07-15',
      sourceSha256: 'a'.repeat(64),
      mainSetPositions: kept + dropped,
    },
    kept,
    dropped,
    census: {
      kept: { positions: kept, byRarity: [{ rarity: 'common', positions: kept }], byColor: [] },
      dropped: { positions: dropped, byRarity: [{ rarity: 'rare', positions: dropped }], byColor: [] },
    },
    collation: {
      fillsAPack: true,
      sheets: [{ name: 'rareMythic', sourceCards: 68, cards: 13, weights: sheetWeights(13) }],
      emptiedSheets: [],
      boosters: [{ contents: { rareMythic: 1 }, weight: 1, packSize: 15 }],
      unfillableBoosters: 0,
    },
    drops: [],
  };
}

/** The same cards, carried by the document that says how many are missing. */
function reducedDocument(block: unknown = reduction(20, 229)): unknown {
  return {
    formatVersion: 1,
    kind: 'position-reduced-reference-set-document',
    set: { code: 'RDX', name: 'a pinned reference printing (reduced)', reduced: true },
    reduction: block,
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

function setHash(hash: string): void {
  const source = hashSource();
  if (source === null) throw new Error('this test needs a browser location');
  source.location.hash = hash;
}

function openLab(): void {
  render(h(LabApp, { setUrl: 'set.json', cards: EXAMPLE_CARDS }));
}

describe('reading the reduction off a staged document', () => {
  it('reads the counts the notice is composed from', () => {
    const found = readReduction(reducedDocument());
    expect(found?.sourceName).toBe('a pinned reference printing');
    expect(found?.sourcePositions).toBe(249);
    expect(found?.kept).toBe(20);
    expect(found?.dropped).toBe(229);
  });

  it('says nothing about an ordinary set document', () => {
    expect(readReduction(COMPLETE)).toBeNull();
    expect(readReduction(null)).toBeNull();
    expect(readReduction({ kind: 'executable-reference-set-document' })).toBeNull();
  });

  it('says nothing rather than something partial when the block is malformed', () => {
    // Every one of these is a block that is present and claims to be a
    // reduction. A sentence composed from any of them would be missing a
    // number, and a disclosure missing a number is worse than none.
    expect(readReduction(reducedDocument({ kept: 20, dropped: 229 }))).toBeNull();
    expect(readReduction(reducedDocument({ ...reduction(20, 229), kept: -3 }))).toBeNull();
    expect(readReduction(reducedDocument({ ...reduction(20, 229), dropped: '229' }))).toBeNull();
    expect(readReduction(reducedDocument({ ...reduction(20, 229), source: {} }))).toBeNull();
    expect(readReduction(reducedDocument('a reduction, honestly'))).toBeNull();
  });
});

describe('the sentence', () => {
  const found = readReduction(reducedDocument());

  it('names the set, the split and what a drop is not', () => {
    if (found === null) throw new Error('this test needs a reduction');
    expect(reducedNoticeText(found)).toBe(
      "Reduced build: 20 of a pinned reference printing's 249 collector positions. " +
        'The other 229 were refused by the translation gate and are not in this set; ' +
        'nothing was approximated or substituted.',
    );
  });

  it('does not claim a refusal when the reduction refused nothing', () => {
    const whole = readReduction(reducedDocument(reduction(249, 0)));
    if (whole === null) throw new Error('this test needs a reduction');
    expect(reducedNoticeText(whole)).toContain('No collector position was refused');
    expect(reducedNoticeText(whole)).toContain('nothing was approximated or substituted');
  });
});

describe('the shell over a staged reduced set', () => {
  it.each(['#/play', '#/cards', '#/deck', '#/draft', '#/analysis', '#/replay'])(
    'discloses the refused positions on %s',
    async (hash) => {
      stubFetch({ 'set.json': reducedDocument() });
      setHash(hash);
      openLab();

      // Reached through the role matcher rather than through `textContent`: the
      // workspace tsconfig has no `lib: dom`, which is why nothing in this
      // package types an element's DOM properties.
      const notice = await waitFor(() => screen.getByRole('status', { name: SHELL_NOTICE_LABEL }));
      expect(notice).toBeTruthy();
      expect(screen.getByText(/20 of a pinned reference printing's 249 collector positions/)).toBeTruthy();
      expect(screen.getByText(/The other 229 were refused/)).toBeTruthy();
    },
  );

  it('says nothing extra over an ordinary set', async () => {
    stubFetch({ 'set.json': COMPLETE });
    setHash('#/cards');
    openLab();

    await waitFor(() => {
      expect(screen.getByRole('main')).toBeTruthy();
    });
    expect(screen.queryByRole('status', { name: SHELL_NOTICE_LABEL })).toBeNull();
  });

  it('says nothing at all when the block is present but malformed', async () => {
    stubFetch({ 'set.json': reducedDocument({ kept: 20, dropped: 229 }) });
    setHash('#/cards');
    openLab();

    await waitFor(() => {
      expect(screen.getByRole('main')).toBeTruthy();
    });
    expect(screen.queryByRole('status', { name: SHELL_NOTICE_LABEL })).toBeNull();
  });
});
