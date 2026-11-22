import { describe, expect, it } from 'vitest';
import {
  deckWinRate,
  parseCommanderHeadToHeadResults,
  parsePrintedDeckWinRates,
  rankHeadToHeadByCloseness,
  rankOpponentsByCloseness,
} from '@mtg/printed-card';
import {
  CLOSEST_MATCH_UNAVAILABLE_COPY,
  NO_HEAD_TO_HEAD_OPPONENT_COPY,
  NO_WIN_RATE_COPY,
  TOO_FEW_HEAD_TO_HEAD_GAMES_COPY,
  deckWinRateCopy,
  headToHeadBasisCopy,
  headToHeadOpponentCopy,
  headToHeadSeatedCopy,
  opponentGapCopy,
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

const table = parsePrintedDeckWinRates({
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
    row('north', 27.76, 163),
    row('south', 21.19, 177),
    row('west', 29.5, 34),
    row('level', 27.8, 90),
    row('single', 25, 1),
  ],
});

function deck(id: string) {
  return { id, name: `Deck ${id}` };
}

function figure(deckId: string) {
  const found = deckWinRate(table, deckId);
  if (found === undefined) throw new Error(`no figure for ${deckId}`);
  return found;
}

describe('the words a deck pairing is shown in', () => {
  it('states a deck figure with its sample and where it came from', () => {
    expect(deckWinRateCopy(table, figure('north'))).toBe('27.8% pod win rate, 163 games (Example Tracker)');
  });

  it('marks a figure under the source threshold, and counts one game as one game', () => {
    expect(deckWinRateCopy(table, figure('west'))).toBe(
      '29.5% pod win rate, 34 games (Example Tracker), low sample',
    );
    expect(deckWinRateCopy(table, figure('single'))).toBe(
      '25.0% pod win rate, 1 game (Example Tracker), low sample',
    );
  });

  it('says how far each opponent is from the chosen deck, and in which direction', () => {
    const ranking = rankOpponentsByCloseness(
      deck('north'),
      [deck('south'), deck('west'), deck('level'), deck('unlisted')],
      table,
    );
    if (ranking.kind !== 'ranked') throw new Error('expected a ranking');
    expect(ranking.opponents.map((opponent) => opponentGapCopy(table, opponent))).toEqual([
      'Deck level, 27.8%, about even',
      'Deck west, 29.5%, 1.7 points stronger, low sample',
      'Deck south, 21.2%, 6.6 points weaker',
      'Deck unlisted, no measured win rate',
    ]);
  });

  it('says what the figures measure and why they are not odds for a game here', () => {
    const basis = pairingBasisCopy(table);
    expect(basis).toContain('four-player games between people');
    expect(basis).toContain('Example Tracker');
    expect(basis).toContain('one-on-one against the computer');
  });

  it('has a sentence for a deck with no figure and one for the control that needs it', () => {
    expect(NO_WIN_RATE_COPY).toBe('No measured win rate for this deck.');
    expect(CLOSEST_MATCH_UNAVAILABLE_COPY).toContain('this one has none');
  });
});

function headToHeadPairing(a: string, b: string, aWins: number, bWins: number) {
  const decided = aWins + bWins;
  return {
    a,
    b,
    games: decided,
    aWins,
    bWins,
    rulesDraws: 0,
    clockDraws: 0,
    aShare: { point: aWins / decided, low: 0, high: 1 },
  };
}

const headToHead = parseCommanderHeadToHeadResults({
  schemaVersion: 2,
  pairings: [
    headToHeadPairing('north', 'south', 22, 18),
    headToHeadPairing('north', 'west', 30, 10),
    headToHeadPairing('north', 'thin', 7, 8),
  ],
});

describe('the words a lab head-to-head figure is shown in', () => {
  it("states the measured deck's record and share in decided games", () => {
    const ranking = rankHeadToHeadByCloseness(deck('north'), [deck('south'), deck('west')], headToHead);
    expect(ranking.map((entry) => headToHeadOpponentCopy(deck('north'), entry))).toEqual([
      'Deck south, Deck north won 22 of 40 decided games (55.0%)',
      'Deck west, Deck north won 30 of 40 decided games (75.0%)',
    ]);
  });

  it('names a thin pairing and a pairing never measured the same way, as too few games', () => {
    const ranking = rankHeadToHeadByCloseness(deck('north'), [deck('thin'), deck('unlisted')], headToHead);
    expect(ranking.map((entry) => headToHeadOpponentCopy(deck('north'), entry))).toEqual([
      `Deck thin, ${TOO_FEW_HEAD_TO_HEAD_GAMES_COPY}`,
      `Deck unlisted, ${TOO_FEW_HEAD_TO_HEAD_GAMES_COPY}`,
    ]);
  });

  it('labels the currently seated opponent distinctly from the ranked list wording', () => {
    const ranking = rankHeadToHeadByCloseness(deck('north'), [deck('south')], headToHead);
    expect(headToHeadSeatedCopy(deck('north'), ranking[0]!)).toBe(
      'Head-to-head so far: Deck south, Deck north won 22 of 40 decided games (55.0%)',
    );
  });

  it('says what the figure measures and that it is a second, separate fact', () => {
    const basis = headToHeadBasisCopy();
    expect(basis).toContain("Forge's own computer");
    expect(basis).toContain('never averaged');
  });

  it('has a sentence for the control that needs a lab measurement and has none', () => {
    expect(NO_HEAD_TO_HEAD_OPPONENT_COPY).toContain('lab head-to-head measurement');
  });
});
