// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { deckCardCount } from '../support/deck-count';
import {
  preparePrintedLimitedFormat,
  printedSourceFingerprint,
  runPrintedLimitedDraft,
} from '@mtg/draft-export';
import type { PreparedPrintedLimitedFormat } from '@mtg/draft-export';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import { PrintedDraftRoute } from '../../src/routes/printed/PrintedDraftRoute';
import { PrintedDraftRatingsSchema, type PrintedDraftRatings } from '../../src/lab/printed-draft-ratings';
import { readStored, writeStored } from '../../src/routes/deck/local-store';
import { botForNewPrintedDraft, createPrintedReplayBot } from '../../src/routes/printed/draft-bot';
import * as BackendGameModule from '../../src/routes/play/BackendGame';

/**
 * Budgeted at 20s rather than left to vitest's 5s default. Measured with this
 * file alone, MTG_TEST_WORKERS=1, three runs at host load 9.3 to 10.3 on 16
 * cores: the slowest test (finishing all three rounds) took 2.7 to 3.4s, so
 * 20s is about 6x the worst run.
 *
 * The default was too tight under load: tests in this file went past 5s at
 * load 28.9, so the default decided which lane went red.
 *
 * File-scoped on purpose: the global `testTimeout` stays at the default and
 * nothing retries (`mtg-tqwbq`).
 */
vi.setConfig({ testTimeout: 20_000 });

let prepared: PreparedPrintedLimitedFormat;
let innistrad: PreparedPrintedLimitedFormat;
let innistradRatings: PrintedDraftRatings;
let khans: PreparedPrintedLimitedFormat;
const playProps = {
  printedCards: [],
  playAvailability: { status: 'unavailable' as const, reason: 'Full Forge admission is incomplete.' },
};
beforeAll(async () => {
  const read = (name: string): unknown =>
    JSON.parse(readFileSync(`packages/data/data/akh-hou/${name}`, 'utf8'));
  prepared = await preparePrintedLimitedFormat(
    read('akh-hou-limited-format-v1.json'),
    ['akh', 'hou', 'mp2'].map((code) => read(`${code}-printed-catalog-v1.json`)),
    async (text) => createHash('sha256').update(text).digest('hex'),
  );
  const innistradRoot = 'packages/data/data/isd';
  const innistradRead = (name: string): unknown =>
    JSON.parse(readFileSync(`${innistradRoot}/${name}`, 'utf8'));
  innistrad = await preparePrintedLimitedFormat(
    innistradRead('isd-limited-format-v1.json'),
    [innistradRead('isd-printed-catalog-v1.json')],
    async (text) => createHash('sha256').update(text).digest('hex'),
  );
  const catalog = parsePrintedCardCatalog(innistradRead('isd-printed-catalog-v1.json'));
  innistradRatings = PrintedDraftRatingsSchema.parse({
    schemaVersion: 1,
    kind: 'printed-draft-ratings',
    source: {
      kind: 'forge-limited-rankings',
      version: 'test',
      bridgeFingerprint: 'c'.repeat(64),
      fingerprint: 'd'.repeat(64),
    },
    catalogs: [
      {
        code: 'ISD',
        catalogSha256: catalog.contentSha256,
        cards: catalog.cards.map((card) => ({
          physicalId: card.physicalId,
          sourceFingerprint: printedSourceFingerprint(card),
          quality: card.correctedName === 'Reaper from the Abyss' ? 5 : 0,
        })),
      },
    ],
  });
  const ktkRoot = 'packages/data/data/ktk';
  const ktkRead = (name: string): unknown => JSON.parse(readFileSync(`${ktkRoot}/${name}`, 'utf8'));
  khans = await preparePrintedLimitedFormat(
    ktkRead('ktk-limited-format-v1.json'),
    [ktkRead('ktk-printed-catalog-v1.json')],
    async (text) => createHash('sha256').update(text).digest('hex'),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('keeps every automated pick identical to the scalar scorer path', () => {
  const replay = createPrintedReplayBot(botForNewPrintedDraft(prepared).botPolicy);
  expect(replay.choose).toBeTypeOf('function');
  const scalar = { botPolicy: replay.botPolicy, score: replay.score };
  const options = { seed: 'draft-ui-batch-parity' };

  expect(runPrintedLimitedDraft(prepared, { ...replay, ...options })).toEqual(
    runPrintedLimitedDraft(prepared, { ...scalar, ...options }),
  );
});

it('selects before committing a physical pick and restores the next pack from storage', () => {
  const props = { prepared, seed: 'draft-ui-resume', onNewDraft: vi.fn(), ...playProps };
  const view = render(h(PrintedDraftRoute, props));
  expect(screen.getByText('Pack 1 · Pick 1')).toBeTruthy();
  expect(screen.queryByText(/Deck-aware bots.*authored set evaluations/)).toBeNull();
  const pack = screen.getByRole('group', { name: /^Draft pack / });
  const card = within(pack).getAllByRole('button')[0]!;
  fireEvent.click(card);
  expect(screen.getByText('Pack 1 · Pick 1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^Pick / }));
  expect(screen.getByText('Pack 1 · Pick 2')).toBeTruthy();
  expect(JSON.parse(readStored('mtg.printed.draft:akh-hou:draft-ui-resume')!).transcript.botPolicy).toMatch(
    /^limited-deck-value/,
  );
  view.unmount();
  render(h(PrintedDraftRoute, props));
  expect(screen.getByText('Pack 1 · Pick 2')).toBeTruthy();
});

it('uses the staged Innistrad rankings through the route and selects the ranked bomb', () => {
  const seed = 'isd-user-report/3';
  const bot = createPrintedReplayBot(
    botForNewPrintedDraft(innistrad, innistradRatings).botPolicy,
    innistradRatings,
  );
  const opening = innistrad
    .openDraftPacks(seed)
    .find(
      (pack) =>
        pack.round === 1 &&
        pack.openedBy === 'seat-2' &&
        pack.cards.some((card) => card.payload.printing.correctedName === 'Reaper from the Abyss'),
    )!;
  const selected = bot.choose!({
    cards: opening.cards,
    seatId: 'seat-2',
    picked: [],
    round: 1,
    pickNumber: 1,
    packSize: opening.cards.length,
    openedBy: opening.openedBy,
  });
  expect(opening.cards[selected]!.payload.printing.correctedName).toBe('Reaper from the Abyss');

  render(
    h(PrintedDraftRoute, {
      prepared: innistrad,
      draftRatings: innistradRatings,
      seed,
      onNewDraft: vi.fn(),
      ...playProps,
    }),
  );
  // The bot policy is recorded, not announced: the pack has the whole column.
  expect(screen.queryByText(/deck-aware picks/)).toBeNull();
  fireEvent.click(within(screen.getByRole('group', { name: /^Draft pack / })).getAllByRole('button')[0]!);
  fireEvent.click(screen.getByRole('button', { name: /^Pick / }));
  expect(JSON.parse(readStored(`mtg.printed.draft:isd:${seed}`)!).transcript.botPolicy).toMatch(
    /^limited-deck-value\/printed-forge-rank-v3\/[a-f0-9]{64}$/u,
  );
  for (let index = 1; index < 42; index += 1) {
    fireEvent.click(within(screen.getByRole('group', { name: /^Draft pack / })).getAllByRole('button')[0]!);
    fireEvent.click(screen.getByRole('button', { name: /^Pick / }));
  }
  expect(screen.getByText(/Deck suggestions use staged Forge set rankings/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Suggest a build' }));
  expect(deckCardCount()).toBe(40);
});

it('shows the staged Forge Limited ranking for a pointed-at card', () => {
  render(
    h(PrintedDraftRoute, {
      prepared: innistrad,
      draftRatings: innistradRatings,
      seed: 'isd-rating-panel',
      onNewDraft: vi.fn(),
      ...playProps,
    }),
  );
  const pack = screen.getByRole('group', { name: /^Draft pack / });
  fireEvent.click(within(pack).getAllByRole('button')[0]!);
  expect(screen.getByText(/^Forge Limited ranking: \d\.\d\/5$/)).toBeTruthy();
  expect(screen.queryByText('No ranking for this set.')).toBeNull();
});

it('shows the 17lands rating and its source for KTK, with no staged Forge ranking at all', () => {
  render(
    h(PrintedDraftRoute, { prepared: khans, seed: 'ktk-rating-panel', onNewDraft: vi.fn(), ...playProps }),
  );
  const pack = screen.getByRole('group', { name: /^Draft pack / });
  fireEvent.click(within(pack).getAllByRole('button')[0]!);
  expect(
    screen.getByText(/^17lands measured human play: (\d\.\d\/5|not ranked for this card\.)$/),
  ).toBeTruthy();
  expect(screen.queryByText('No ranking for this set.')).toBeNull();
  expect(screen.queryByText(/^Forge Limited ranking/)).toBeNull();
});

it('says there is no ranking for a format with no staged draft ratings', () => {
  render(h(PrintedDraftRoute, { prepared, seed: 'draft-ui-no-ratings', onNewDraft: vi.fn(), ...playProps }));
  const pack = screen.getByRole('group', { name: /^Draft pack / });
  fireEvent.click(within(pack).getAllByRole('button')[0]!);
  expect(screen.getByText('No ranking for this set.')).toBeTruthy();
});

it('says nothing above the pack while a supported draft is in progress', () => {
  render(
    h(PrintedDraftRoute, {
      prepared,
      seed: 'draft-ui-supported',
      onNewDraft: vi.fn(),
      printedCards: [],
      playAvailability: {
        status: 'supported',
        reason: 'Verified full-card and match interaction admission is installed.',
      },
    }),
  );
  expect(screen.queryByText(/Verified full-card and match interaction admission is installed/)).toBeNull();
  expect(screen.queryByText(/Forge gameplay validation is pending/)).toBeNull();
  expect(screen.getByText('Pack 1 · Pick 1')).toBeTruthy();
});

it('finishes all three rounds into the shared physical deck editor', () => {
  const props = { prepared, seed: 'draft-ui-complete', onNewDraft: vi.fn(), ...playProps };
  const view = render(h(PrintedDraftRoute, props));
  for (let index = 0; index < 42; index += 1) {
    expect(screen.getByText(`Pack ${Math.floor(index / 14) + 1} · Pick ${(index % 14) + 1}`)).toBeTruthy();
    fireEvent.click(within(screen.getByRole('group', { name: /^Draft pack / })).getAllByRole('button')[0]!);
    fireEvent.click(screen.getByRole('button', { name: /^Pick / }));
  }
  expect(screen.getByText(/Draft complete/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Suggest a build' }));
  expect(deckCardCount()).toBe(40);
  expect(
    (screen.getByRole('button', { name: 'Forge play unavailable' }) as unknown as { disabled: boolean })
      .disabled,
  ).toBe(true);
  view.unmount();
  render(h(PrintedDraftRoute, props));
  expect(deckCardCount()).toBe(40);
});

it('returns to the drafted pool when a finished match requests a new game', () => {
  vi.spyOn(BackendGameModule, 'BackendGame').mockImplementation((game) =>
    h('button', { onClick: game.onNewGame }, 'New game'),
  );
  render(
    h(PrintedDraftRoute, {
      prepared,
      seed: 'draft-new-game',
      onNewDraft: vi.fn(),
      backend: {
        id: 'draft-new-game',
        determinism: 'observed',
        capabilities: { undo: false, fork: false, perSeatProjection: true, engineSeats: true },
        supports: () => Promise.resolve([]),
        open: () => Promise.reject(new Error('mocked BackendGame must not open the backend')),
      },
      playAvailability: { status: 'supported', reason: 'Verified admission loaded.' },
      printedCards: [],
    }),
  );
  for (let index = 0; index < 42; index += 1) {
    fireEvent.click(within(screen.getByRole('group', { name: /^Draft pack / })).getAllByRole('button')[0]!);
    fireEvent.click(screen.getByRole('button', { name: /^Pick / }));
  }
  fireEvent.click(screen.getByRole('button', { name: 'Suggest a build' }));
  fireEvent.click(screen.getByRole('button', { name: 'Play Forge match' }));
  fireEvent.click(screen.getByRole('button', { name: 'New game' }));

  expect(screen.getByRole('group', { name: 'Drafted pool' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Play Forge match' })).toBeTruthy();
});

it('preserves corrupt saved bytes and reports the failure', () => {
  const key = 'mtg.printed.draft:akh-hou:draft-ui-corrupt';
  writeStored(key, '{broken');
  render(h(PrintedDraftRoute, { prepared, seed: 'draft-ui-corrupt', onNewDraft: vi.fn(), ...playProps }));
  expect(screen.getByText('Cannot restore draft')).toBeTruthy();
  expect((screen.getByRole('alert') as unknown as { textContent: string }).textContent).toBeTruthy();
  expect(readStored(key)).toBe('{broken');
});

it('restores an older draft with its original policy and retains its recorded pick', () => {
  const seed = 'draft-ui-legacy';
  const key = `mtg.printed.draft:akh-hou:${seed}`;
  const card = prepared.openDraftPacks(seed)[0]!.cards[0]!;
  writeStored(
    key,
    JSON.stringify({
      mode: 'draft',
      transcript: {
        version: 1,
        formatId: prepared.format.id,
        fingerprint: prepared.fingerprint,
        seed,
        humanSeatIds: ['seat-1'],
        picks: { 'seat-1': [card.physicalId] },
      },
    }),
  );
  render(h(PrintedDraftRoute, { prepared, seed, onNewDraft: vi.fn(), ...playProps }));
  expect(screen.getByText('Pack 1 · Pick 2')).toBeTruthy();
  // The policy an older transcript carries is kept, not restated above the pack.
  expect(screen.queryByText(/Baseline bots/)).toBeNull();
  expect(JSON.parse(readStored(key)!).transcript.botPolicy).toBeUndefined();
});

it('turns a split card over while it is offered and again once it is picked', () => {
  // draft-ui-flip-1 deals Consign // Oblivion in the first pack.
  render(h(PrintedDraftRoute, { prepared, seed: 'draft-ui-flip-1', onNewDraft: vi.fn(), ...playProps }));
  const pack = screen.getByRole('group', { name: /^Draft pack / });
  fireEvent.click(within(pack).getByRole('button', { name: /^Consign\./ }));
  const rail = screen.getByRole('button', { name: 'Show Oblivion face of Consign // Oblivion' });
  // The pack keeps its front; the reading copy in the rail turns over.
  fireEvent.click(rail);
  expect(within(pack).getByRole('button', { name: /^Consign\./ })).toBeTruthy();
  expect(screen.getByRole('group', { name: /^Oblivion\./ })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Show Consign face of Consign // Oblivion' })).toBeTruthy();
  // A picked card is read from the pool strip the same way.
  fireEvent.click(screen.getByRole('button', { name: /^Pick / }));
  expect(screen.getByText('Pack 1 · Pick 2')).toBeTruthy();
  const pool = screen.getByRole('group', { name: 'Pool' }) as unknown as {
    querySelector(s: string): Element | null;
  };
  fireEvent.click(pool.querySelector('.mtg-strips__card')!);
  fireEvent.click(screen.getByRole('button', { name: 'Show Oblivion face of Consign // Oblivion' }));
  expect(screen.getByRole('group', { name: /^Oblivion\./ })).toBeTruthy();
  // Reading a single-faced card offers nothing to turn.
  fireEvent.click(within(screen.getByRole('group', { name: /^Draft pack / })).getAllByRole('button')[0]!);
  expect(screen.queryByRole('button', { name: /^Show .* face of / })).toBeNull();
});
