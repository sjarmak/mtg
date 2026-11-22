// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { UiRoute } from '../../src/app/router';
import { loadPrintedConstructedFormat } from '../../src/lab/printed-constructed-format';
import type { LoadedPrintedConstructedFormat } from '../../src/lab/printed-constructed-format';
import { PRECON_OPPONENT_PARAM, PrintedPreconRoute } from '../../src/routes/printed/PrintedPreconRoute';
import {
  HEAD_TO_HEAD_PANEL_LABEL,
  HEAD_TO_HEAD_RANKED_LABEL,
  PAIRING_PANEL_LABEL,
  RANKED_OPPONENTS_LABEL,
  TOO_FEW_HEAD_TO_HEAD_GAMES_COPY,
} from '../../src/routes/printed/pairing-copy';

const WIN_RATES_URL = `formats/scd/deck-win-rates-${'d'.repeat(64)}.json`;
const HEAD_TO_HEAD_URL = `formats/scd/head-to-head-${'e'.repeat(64)}.json`;
const row = {
  id: 'scd',
  name: 'Starter Commander Decks 2022',
  kind: 'constructed',
  variant: 'commander',
  formatUrl: 'formats/scd/scd-constructed-format-v1.json',
  catalogs: [{ code: 'SCD', url: 'formats/scd/scd-printed-catalog-v1.json' }],
  availability: {
    browse: 'available',
    draft: 'unavailable',
    sealed: 'unavailable',
    play: { status: 'supported', reason: 'Verified admission is installed.' },
  },
};

function figure(deckId: string, winRatePercent: number) {
  return {
    name: `Deck ${deckId}`,
    product: 'Example Product',
    commander: `Commander of ${deckId}`,
    winRatePercent,
    games: 100,
    setCode: 'EXA',
    deckId,
  };
}

const winRates = {
  schemaVersion: 1,
  kind: 'commander-precon-win-rates',
  source: {
    name: 'Example Tracker',
    url: 'https://example.test/precons',
    retrieved: '2026-10-10',
    sourceUpdated: '2026-10-10T16:02:00Z',
    pageSha256: 'a'.repeat(64),
    measure: 'win rate of the stock list in tracked four-player games',
    minimumSample: 'at least 20 tracked stock games',
    lowSampleBelowGames: 40,
  },
  decks: [
    figure('chaos-incarnate', 20),
    figure('draconic-destruction', 28),
    figure('first-flight', 21.5),
    figure('grave-danger', 24),
  ],
};

function headToHeadPairing(a: string, b: string, aWins: number, bWins: number) {
  return {
    a,
    b,
    games: aWins + bWins,
    aWins,
    bWins,
    rulesDraws: 0,
    clockDraws: 0,
    aShare: { point: aWins / (aWins + bWins), low: 0, high: 1 },
  };
}

const headToHead = {
  schemaVersion: 2,
  pairings: [
    headToHeadPairing('chaos-incarnate', 'first-flight', 22, 18),
    headToHeadPairing('chaos-incarnate', 'grave-danger', 30, 10),
    headToHeadPairing('chaos-incarnate', 'draconic-destruction', 5, 5),
  ],
};

const read = async (url: string): Promise<unknown> => {
  if (url === WIN_RATES_URL) return winRates;
  if (url === HEAD_TO_HEAD_URL) return headToHead;
  return JSON.parse(readFileSync(`packages/data/data/scd/${url.split('/').at(-1)!}`, 'utf8')) as unknown;
};

let measured: LoadedPrintedConstructedFormat;
let measuredWithHeadToHead: LoadedPrintedConstructedFormat;
let unmeasured: LoadedPrintedConstructedFormat;
beforeAll(async () => {
  vi.stubGlobal('crypto', {
    ...globalThis.crypto,
    subtle: {
      digest: async (_algorithm: string, data: ArrayBuffer) =>
        createHash('sha256').update(Buffer.from(data)).digest().buffer,
    },
    getRandomValues: (array: Uint8Array) => array.fill(7),
  });
  measured = await loadPrintedConstructedFormat({ ...row, deckWinRatesUrl: WIN_RATES_URL }, read);
  measuredWithHeadToHead = await loadPrintedConstructedFormat(
    { ...row, deckWinRatesUrl: WIN_RATES_URL, headToHeadUrl: HEAD_TO_HEAD_URL },
    read,
  );
  unmeasured = await loadPrintedConstructedFormat(row, read);
});
afterEach(cleanup);

function page(loaded: LoadedPrintedConstructedFormat, params: Record<string, string> = {}) {
  const onSetParams = vi.fn();
  render(
    h(PrintedPreconRoute, {
      loaded,
      title: row.name,
      sourceCode: undefined,
      page: 'commander',
      route: { mode: 'play', sub: 'commander', params } as UiRoute,
      onSetParams,
    }),
  );
  return onSetParams;
}

const textOf = (element: unknown): string => (element as { textContent: string | null }).textContent ?? '';

describe('the Commander deck picker with measured win rates', () => {
  it('ranks the other decks against the one chosen and seats the one pressed', () => {
    const onSetParams = page(measured);
    const region = screen.getByRole('region', { name: PAIRING_PANEL_LABEL });
    expect(textOf(region)).toContain('Your deck: Chaos Incarnate, 20.0% pod win rate, 100 games');
    expect(textOf(region)).toContain('Across the table: Draconic Destruction, 28.0%, 8.0 points stronger');
    const ranked = within(screen.getByRole('group', { name: RANKED_OPPONENTS_LABEL })).getAllByRole('button');
    expect(ranked.map(textOf)).toEqual([
      'First Flight, 21.5%, 1.5 points stronger',
      'Grave Danger, 24.0%, 4.0 points stronger',
      'Draconic Destruction, 28.0%, 8.0 points stronger',
      'Token Triumph, no measured win rate',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Seat the closest match: First Flight' }));
    expect(onSetParams).toHaveBeenLastCalledWith({ [PRECON_OPPONENT_PARAM]: 'first-flight' });
  });

  it('follows the opponent the address names', () => {
    page(measured, { [PRECON_OPPONENT_PARAM]: 'first-flight' });
    expect(textOf(screen.getByRole('region', { name: PAIRING_PANEL_LABEL }))).toContain(
      'First Flight is the closest measured match for Chaos Incarnate.',
    );
  });

  it('draws no pairing panel for a format staged without figures', () => {
    page(unmeasured);
    expect(screen.queryByRole('region', { name: PAIRING_PANEL_LABEL })).toBeNull();
    expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0);
  });
});

describe('the Commander deck picker with lab head-to-head results', () => {
  it('shows the lab figure beside the win rate, closest first, and reads a thin pairing as too few games', () => {
    page(measuredWithHeadToHead, { [PRECON_OPPONENT_PARAM]: 'first-flight' });
    const region = screen.getByRole('region', { name: PAIRING_PANEL_LABEL });
    expect(textOf(region)).toContain(HEAD_TO_HEAD_PANEL_LABEL);
    expect(textOf(region)).toContain(
      'Head-to-head so far: First Flight, Chaos Incarnate won 22 of 40 decided games (55.0%)',
    );
    const ranked = within(screen.getByRole('group', { name: HEAD_TO_HEAD_RANKED_LABEL })).getAllByRole(
      'button',
    );
    expect(ranked.map(textOf)).toEqual([
      'First Flight, Chaos Incarnate won 22 of 40 decided games (55.0%)',
      'Grave Danger, Chaos Incarnate won 30 of 40 decided games (75.0%)',
      `Draconic Destruction, ${TOO_FEW_HEAD_TO_HEAD_GAMES_COPY}`,
      `Token Triumph, ${TOO_FEW_HEAD_TO_HEAD_GAMES_COPY}`,
    ]);
  });

  it('shows no lab section for a format staged without a head-to-head file', () => {
    page(measured);
    const region = screen.getByRole('region', { name: PAIRING_PANEL_LABEL });
    expect(textOf(region)).not.toContain(HEAD_TO_HEAD_PANEL_LABEL);
    expect(screen.queryByRole('group', { name: HEAD_TO_HEAD_RANKED_LABEL })).toBeNull();
  });
});
