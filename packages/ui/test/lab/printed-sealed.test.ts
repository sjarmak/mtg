// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { deckCardCount } from '../support/deck-count';
import { waitFor } from '@testing-library/react';
import type { ObservedBackend, SessionSpec } from '@mtg/engine';
import { preparePrintedLimitedFormat, printedSourceFingerprint } from '@mtg/draft-export';
import type { PreparedPrintedLimitedFormat } from '@mtg/draft-export';
import { prepareLimitedDeck } from '@mtg/limited';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import { PrintedDraftRatingsSchema } from '../../src/lab/printed-draft-ratings';
import { PrintedSealedRoute } from '../../src/routes/printed/PrintedSealedRoute';
import { suggestPrintedDeck } from '../../src/routes/printed/deck-evaluation';
import { printedLimitedFacts } from '../../src/routes/printed/limited-facts';
import { readStored } from '../../src/routes/deck/local-store';
import * as BackendGameModule from '../../src/routes/play/BackendGame';

let prepared: PreparedPrintedLimitedFormat;
let innistrad: PreparedPrintedLimitedFormat;
let innistradCatalog: PrintedCardCatalog;
beforeAll(async () => {
  const read = (file: string): unknown =>
    JSON.parse(readFileSync(`packages/data/data/akh-hou/${file}`, 'utf8'));
  prepared = await preparePrintedLimitedFormat(
    read('akh-hou-limited-format-v1.json'),
    ['akh', 'hou', 'mp2'].map((code) => read(`${code}-printed-catalog-v1.json`)),
    async (text) => createHash('sha256').update(text).digest('hex'),
  );
  const innistradRead = (file: string): unknown =>
    JSON.parse(readFileSync(`packages/data/data/isd/${file}`, 'utf8'));
  innistradCatalog = parsePrintedCardCatalog(innistradRead('isd-printed-catalog-v1.json'));
  innistrad = await preparePrintedLimitedFormat(
    innistradRead('isd-limited-format-v1.json'),
    [innistradCatalog],
    async (text) => createHash('sha256').update(text).digest('hex'),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('opens six mixed packs in the shared editor, saves edits, and restores on remount', async () => {
  const view = render(h(PrintedSealedRoute, { prepared, seed: 'sealed-ui-test' }));
  await screen.findByText(/84 physical cards/);
  expect(
    (screen.getByRole('button', { name: 'Forge play unavailable' }) as unknown as { disabled: boolean })
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Suggest a build' }));
  // mtg-84703. The wait is on the record the editor writes, not on a control
  // that is drawn whether or not anything was saved. The banner this used to
  // wait for ("Deck saved in this browser") went with the status line, and a
  // toolbar button standing in for it resolves on the first render, which would
  // make the next line the only thing between this case and the save it is
  // named for.
  await waitFor(() => {
    const saved = JSON.parse(readStored(`mtg.printed.sealed:${prepared.format.id}:sealed-ui-test`)!) as {
      readonly deck: {
        readonly selectedPhysicalIds: readonly string[];
        readonly basics: Readonly<Record<string, number>>;
      };
    };
    // The stored deck is the picked printings plus the basics beside them
    // (`../../src/routes/printed/printed-limited-session.ts`), which is the
    // same forty cards the pane's note counts.
    const basics = Object.values(saved.deck.basics).reduce((sum, count) => sum + count, 0);
    expect(saved.deck.selectedPhysicalIds.length + basics).toBe(40);
  });
  expect(deckCardCount()).toBe(40);
  view.unmount();
  render(h(PrintedSealedRoute, { prepared, seed: 'sealed-ui-test' }));
  expect(deckCardCount()).toBe(40);
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(deckCardCount()).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Add a Forest' }));
  expect(deckCardCount()).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'Cut a Forest' }));
  expect(deckCardCount()).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Suggest a mana base' }));
});

it('starts a backend-neutral match only when the format capability permits play', async () => {
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(((array: Uint8Array) => {
    array.fill(7);
    return array;
  }) as typeof globalThis.crypto.getRandomValues);
  const opened: SessionSpec[] = [];
  const backend: ObservedBackend = {
    id: 'admitted-test',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: true, engineSeats: true },
    supports: () => Promise.resolve([]),
    open: (table) => {
      opened.push(table);
      return Promise.resolve({
        ok: false,
        error: { kind: 'backend-failure', message: 'captured admitted match' },
      });
    },
  };
  render(
    h(PrintedSealedRoute, {
      prepared,
      seed: 'sealed-supported-play',
      backend,
      playAvailability: { status: 'supported', reason: 'Verified admission loaded.' },
      printedCards: [],
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Suggest a build' }));
  fireEvent.click(screen.getByRole('button', { name: 'Play Forge match' }));
  await waitFor(() => expect(opened).toHaveLength(1));
  expect(opened[0]).toMatchObject({ content: { kind: 'printed', format: 'akh-hou' } });
  expect(await screen.findByText(/captured admitted match/)).toBeTruthy();
});

it('returns to the sealed pool when a finished match requests a new game', () => {
  vi.spyOn(BackendGameModule, 'BackendGame').mockImplementation((game) =>
    h('button', { onClick: game.onNewGame }, 'New game'),
  );
  render(
    h(PrintedSealedRoute, {
      prepared,
      seed: 'sealed-new-game',
      backend: {
        id: 'sealed-new-game',
        determinism: 'observed',
        capabilities: { undo: false, fork: false, perSeatProjection: true, engineSeats: true },
        supports: () => Promise.resolve([]),
        open: () => Promise.reject(new Error('mocked BackendGame must not open the backend')),
      },
      playAvailability: { status: 'supported', reason: 'Verified admission loaded.' },
      printedCards: [],
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Suggest a build' }));
  fireEvent.click(screen.getByRole('button', { name: 'Play Forge match' }));
  fireEvent.click(screen.getByRole('button', { name: 'New game' }));

  expect(screen.getByRole('group', { name: 'Sealed pool' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Play Forge match' })).toBeTruthy();
});

it('uses staged Innistrad rankings in the sealed suggestion route', async () => {
  const seed = 'ranked-sealed-ui';
  const pool = innistrad.openSealedPool(seed).cards;
  const initial = prepareLimitedDeck(pool, (card) => printedLimitedFacts(card.payload.printing));
  const structural = suggestPrintedDeck(initial);
  const promoted = pool.find(
    (card) =>
      !structural.selectedPhysicalIds.includes(card.physicalId) &&
      !/\bLand\b/u.test(card.payload.printing.typeLine) &&
      pool.filter((copy) => copy.payload.printing.physicalId === card.payload.printing.physicalId).length ===
        1,
  )!;
  expect(promoted).toBeDefined();
  const ratings = PrintedDraftRatingsSchema.parse({
    schemaVersion: 1,
    kind: 'printed-draft-ratings',
    source: {
      kind: 'forge-limited-rankings',
      version: 'test',
      bridgeFingerprint: 'd'.repeat(64),
      fingerprint: 'e'.repeat(64),
    },
    catalogs: [
      {
        code: 'ISD',
        catalogSha256: innistradCatalog.contentSha256,
        cards: innistradCatalog.cards.map((card) => ({
          physicalId: card.physicalId,
          sourceFingerprint: printedSourceFingerprint(card),
          quality: card.physicalId === promoted.payload.printing.physicalId ? 5 : 0,
        })),
      },
    ],
  });
  expect(suggestPrintedDeck(initial, ratings).selectedPhysicalIds).toContain(promoted.physicalId);

  render(h(PrintedSealedRoute, { prepared: innistrad, draftRatings: ratings, seed }));
  expect(screen.getByText(/Deck suggestions use staged Forge set rankings/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Suggest a build' }));
  await waitFor(() => {
    const saved = JSON.parse(readStored(`mtg.printed.sealed:isd:${seed}`)!);
    expect(saved.deck.selectedPhysicalIds).toContain(promoted.physicalId);
  });
});

it('lets experimental play try the available Forge backend', async () => {
  const open = vi.fn(() =>
    Promise.resolve({
      ok: false as const,
      error: { kind: 'backend-failure' as const, message: 'refused for the test' },
    }),
  );
  const backend: ObservedBackend = {
    id: 'admitted-test',
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: true, engineSeats: true },
    supports: () => Promise.resolve([]),
    open,
  };
  render(
    h(PrintedSealedRoute, {
      prepared,
      seed: 'sealed-experimental-play',
      backend,
      playAvailability: { status: 'experimental', reason: 'Experimental route is not installed.' },
      printedCards: [],
    }),
  );
  expect(screen.getByText('You can try a Forge match, but it may stop.')).toBeTruthy();
  expect(screen.queryByText(/Experimental route is not installed/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Suggest a build' }));
  const button = screen.getByRole('button', { name: 'Try experimental Forge match' });
  expect((button as unknown as { disabled: boolean }).disabled).toBe(false);
  fireEvent.click(button);
  await waitFor(() => expect(open).toHaveBeenCalledOnce());
});

it('does not overwrite an invalid saved session while showing its error', async () => {
  const host = globalThis as unknown as {
    localStorage: { setItem(key: string, value: string): void; getItem(key: string): string | null };
  };
  const key = `mtg.printed.sealed:${prepared.format.id}:broken`;
  host.localStorage.setItem(key, '{broken');
  render(h(PrintedSealedRoute, { prepared, seed: 'broken' }));
  await screen.findByRole('alert');
  expect(host.localStorage.getItem(key)).toBe('{broken');
  expect(screen.queryByRole('button', { name: 'Suggest a build' })).toBeNull();
});

it('turns a split card over inside the builder preview', async () => {
  // sealed-ui-flip-1 deals Never // Return.
  render(h(PrintedSealedRoute, { prepared, seed: 'sealed-ui-flip-1' }));
  await screen.findByText(/84 physical cards/);
  fireEvent.contextMenu(screen.getByRole('button', { name: /^Never\./ }));
  const flip = screen.getByRole('button', { name: 'Show Return face of Never // Return' });
  const peek = (
    flip as unknown as {
      parentElement: { className: string; getAttribute(name: string): string | null } | null;
    }
  ).parentElement;
  expect(peek?.className).toContain('mtg-cardpeek');
  expect(peek?.getAttribute('aria-hidden')).toBeNull();
  fireEvent.click(flip);
  expect(screen.getByRole('group', { name: /^Return\./ })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Show Never face of Never // Return' })).toBeTruthy();
});
