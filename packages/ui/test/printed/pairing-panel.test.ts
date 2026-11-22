// @vitest-environment jsdom
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { parseCommanderHeadToHeadResults, parsePrintedDeckWinRates } from '@mtg/printed-card';
import type { CommanderHeadToHeadResults } from '@mtg/printed-card';
import { PrintedPairingPanel } from '../../src/routes/printed/PrintedPairingPanel';
import {
  CLOSEST_MATCH_UNAVAILABLE_COPY,
  HEAD_TO_HEAD_PANEL_LABEL,
  HEAD_TO_HEAD_RANKED_LABEL,
  NO_HEAD_TO_HEAD_OPPONENT_COPY,
  NO_MEASURED_OPPONENT_COPY,
  NO_WIN_RATE_COPY,
  PAIRING_PANEL_LABEL,
  RANKED_OPPONENTS_LABEL,
  TOO_FEW_HEAD_TO_HEAD_GAMES_COPY,
  headToHeadBasisCopy,
  pairingBasisCopy,
} from '../../src/routes/printed/pairing-copy';

function row(deckId: string, winRatePercent: number, games: number) {
  return {
    name: `Deck ${deckId}`,
    product: 'Example Product',
    commander: `Commander of ${deckId}`,
    winRatePercent,
    games,
    setCode: 'EXA',
    deckId,
  };
}

function tableOf(decks: readonly ReturnType<typeof row>[]) {
  return parsePrintedDeckWinRates({
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
    decks,
  });
}

function headToHeadPairing(a: string, b: string, aWins: number, bWins: number, clockDraws = 0) {
  const decisive = aWins + bWins;
  return {
    a,
    b,
    games: aWins + bWins + clockDraws,
    aWins,
    bWins,
    rulesDraws: 0,
    clockDraws,
    aShare: decisive === 0 ? null : { point: aWins / decisive, low: 0, high: 1 },
  };
}

function headToHeadTableOf(
  pairings: readonly ReturnType<typeof headToHeadPairing>[],
): CommanderHeadToHeadResults {
  return parseCommanderHeadToHeadResults({ schemaVersion: 2, pairings });
}

const table = tableOf([row('north', 27.76, 163), row('south', 21.19, 177), row('west', 29.5, 34)]);
const deck = (id: string) => ({ id, name: `Deck ${id}` });
const decks = [deck('north'), deck('south'), deck('west'), deck('unlisted')];

afterEach(cleanup);

function panel(
  mine: string,
  opponent: string | null,
  shown = table,
  headToHead?: CommanderHeadToHeadResults,
) {
  const onChooseOpponent = vi.fn();
  render(
    h(PrintedPairingPanel, {
      table: shown,
      ...(headToHead === undefined ? {} : { headToHead }),
      decks,
      mine: deck(mine),
      opponent: opponent === null ? null : deck(opponent),
      onChooseOpponent,
    }),
  );
  return { onChooseOpponent, region: screen.getByRole('region', { name: PAIRING_PANEL_LABEL }) };
}

const pressed = (element: unknown): string | null =>
  (element as { getAttribute: (name: string) => string | null }).getAttribute('aria-pressed');
const textOf = (element: unknown): string => (element as { textContent: string | null }).textContent ?? '';

describe('the pairing panel on the Commander deck picker', () => {
  it('states both seated decks, ranks every other deck by closeness, and marks the one seated', () => {
    const { region } = panel('north', 'south');
    expect(textOf(region)).toContain(
      'Your deck: Deck north, 27.8% pod win rate, 163 games (Example Tracker)',
    );
    expect(textOf(region)).toContain('Across the table: Deck south, 21.2%, 6.6 points weaker');
    expect(textOf(region)).toContain(pairingBasisCopy(table));
    const ranked = within(screen.getByRole('group', { name: RANKED_OPPONENTS_LABEL })).getAllByRole('button');
    expect(ranked.map(textOf)).toEqual([
      'Deck west, 29.5%, 1.7 points stronger, low sample',
      'Deck south, 21.2%, 6.6 points weaker',
      'Deck unlisted, no measured win rate',
    ]);
    expect(ranked.map(pressed)).toEqual(['false', 'true', 'false']);
  });

  it('seats the closest measured deck in one press, and any ranked deck in one press', () => {
    const { onChooseOpponent } = panel('north', 'south');
    fireEvent.click(screen.getByRole('button', { name: 'Seat the closest match: Deck west' }));
    expect(onChooseOpponent).toHaveBeenLastCalledWith('west');
    fireEvent.click(screen.getByRole('button', { name: 'Deck unlisted, no measured win rate' }));
    expect(onChooseOpponent).toHaveBeenLastCalledWith('unlisted');
  });

  it('says the closest match is already seated instead of offering a press that changes nothing', () => {
    const { region } = panel('north', 'west');
    expect(screen.queryByRole('button', { name: /Seat the closest match/ })).toBeNull();
    expect(textOf(region)).toContain('Deck west is the closest measured match for Deck north.');
  });

  it('reads a deck against itself as even, and still offers the closest other deck', () => {
    const { region } = panel('north', 'north');
    expect(textOf(region)).toContain('Across the table: Deck north, 27.8%, about even');
    expect(screen.getByRole('button', { name: 'Seat the closest match: Deck west' })).toBeDefined();
    expect(
      within(screen.getByRole('group', { name: RANKED_OPPONENTS_LABEL }))
        .getAllByRole('button')
        .map(pressed),
    ).toEqual(['false', 'false', 'false']);
  });

  it('says so when the chosen deck has no figure, and offers no ranking it cannot compute', () => {
    const { region } = panel('unlisted', 'south');
    expect(textOf(region)).toContain(NO_WIN_RATE_COPY);
    expect(textOf(region)).toContain(CLOSEST_MATCH_UNAVAILABLE_COPY);
    expect(screen.queryByRole('group', { name: RANKED_OPPONENTS_LABEL })).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says so when no other deck has a figure', () => {
    const { region } = panel('north', 'south', tableOf([row('north', 27.76, 163)]));
    expect(textOf(region)).toContain(NO_MEASURED_OPPONENT_COPY);
    expect(textOf(region)).toContain('Across the table: Deck south, no measured win rate');
    expect(screen.queryByRole('button', { name: /Seat the closest match/ })).toBeNull();
  });

  it('shows only the chosen deck when the opponent is another person at a network table', () => {
    const { region } = panel('north', null);
    expect(textOf(region)).toContain(
      'Your deck: Deck north, 27.8% pod win rate, 163 games (Example Tracker)',
    );
    expect(textOf(region)).not.toContain('Across the table');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('the lab head-to-head section of the pairing panel', () => {
  const headToHead = headToHeadTableOf([
    headToHeadPairing('north', 'south', 30, 10),
    headToHeadPairing('north', 'west', 22, 18),
    headToHeadPairing('north', 'unlisted', 5, 5),
  ]);

  it('shows the lab figure for every opponent, closest first, with its own label and basis', () => {
    const { region } = panel('north', 'south', table, headToHead);
    expect(textOf(region)).toContain(HEAD_TO_HEAD_PANEL_LABEL);
    expect(textOf(region)).toContain(
      'Head-to-head so far: Deck south, Deck north won 30 of 40 decided games (75.0%)',
    );
    expect(textOf(region)).toContain(headToHeadBasisCopy());
    const ranked = within(screen.getByRole('group', { name: HEAD_TO_HEAD_RANKED_LABEL })).getAllByRole(
      'button',
    );
    expect(ranked.map(textOf)).toEqual([
      'Deck west, Deck north won 22 of 40 decided games (55.0%)',
      'Deck south, Deck north won 30 of 40 decided games (75.0%)',
      `Deck unlisted, ${TOO_FEW_HEAD_TO_HEAD_GAMES_COPY}`,
    ]);
  });

  it('offers the closest lab match in one press, distinct from the win-rate closest match', () => {
    const { onChooseOpponent } = panel('north', 'south', table, headToHead);
    fireEvent.click(screen.getByRole('button', { name: 'Seat the closest head-to-head match: Deck west' }));
    expect(onChooseOpponent).toHaveBeenLastCalledWith('west');
  });

  it('reads too few decided games as a pairing with no share, never as zero', () => {
    const { region } = panel('north', 'unlisted', table, headToHead);
    expect(textOf(region)).toContain(
      `Head-to-head so far: Deck unlisted, ${TOO_FEW_HEAD_TO_HEAD_GAMES_COPY}`,
    );
  });

  it('says so when no other deck has a lab measurement', () => {
    const thin = headToHeadTableOf([headToHeadPairing('north', 'south', 5, 5)]);
    const { region } = panel('north', 'south', table, thin);
    expect(textOf(region)).toContain(NO_HEAD_TO_HEAD_OPPONENT_COPY);
    expect(screen.queryByRole('button', { name: /Seat the closest head-to-head match/ })).toBeNull();
  });

  it('shows no lab section at all in a checkout without the head-to-head file', () => {
    const { region } = panel('north', 'south');
    expect(textOf(region)).not.toContain(HEAD_TO_HEAD_PANEL_LABEL);
    expect(screen.queryByRole('group', { name: HEAD_TO_HEAD_RANKED_LABEL })).toBeNull();
  });
});
