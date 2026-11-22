import { describe, expect, it } from 'vitest';
import {
  HEAD_TO_HEAD_MINIMUM_DECIDED_GAMES,
  headToHeadDecidedGames,
  headToHeadForDecks,
  parseCommanderHeadToHeadResults,
  rankHeadToHeadByCloseness,
} from '../src/head-to-head';
import type { CommanderHeadToHeadResults } from '../src/head-to-head';

function share(point: number, spread = 0.05) {
  return { point, low: Math.max(0, point - spread), high: Math.min(1, point + spread) };
}

function pairing(a: string, b: string, aWins: number, bWins: number, rulesDraws = 0, clockDraws = 0) {
  const decisive = aWins + bWins;
  return {
    a,
    b,
    games: aWins + bWins + rulesDraws + clockDraws,
    aWins,
    bWins,
    rulesDraws,
    clockDraws,
    aShare: decisive === 0 ? null : share(aWins / decisive),
  };
}

function table(pairings: readonly ReturnType<typeof pairing>[]): CommanderHeadToHeadResults {
  return parseCommanderHeadToHeadResults({ schemaVersion: 2, pairings });
}

function deck(id: string, name = `Deck ${id}`) {
  return { id, name };
}

describe('a head-to-head results table', () => {
  it('reads a table and tolerates the measurement tool fields the UI has no use for', () => {
    const richer: unknown = {
      ...pairing('north', 'south', 25, 15),
      seeds: [1, 2, 3],
      gameRecords: [{ winner: 'north' }],
    };
    const rates = parseCommanderHeadToHeadResults({ schemaVersion: 2, pairings: [richer] });
    expect(rates.pairings).toHaveLength(1);
    expect(rates.pairings[0]!.aWins).toBe(25);
  });

  it('refuses a pairing that names one deck on both sides', () => {
    expect(() => table([pairing('north', 'north', 10, 10)])).toThrow(/one deck on both sides/u);
  });

  it('refuses a pairing whose outcomes do not add up to its games', () => {
    const broken = { ...pairing('north', 'south', 20, 20), games: 39 };
    expect(() => table([broken])).toThrow(/add up to its games/u);
  });

  it('refuses a pairing with no decisive games that still carries a share, and one with decisive games and no share', () => {
    const shareWithoutDecisive = { ...pairing('north', 'south', 0, 0, 0, 40), aShare: share(0.5) };
    const decisiveWithoutShare = { ...pairing('north', 'south', 20, 20), aShare: null };
    expect(() => table([shareWithoutDecisive])).toThrow(/decisive game/u);
    expect(() => table([decisiveWithoutShare])).toThrow(/decisive game/u);
  });

  it('refuses two pairings naming the same two decks', () => {
    expect(() => table([pairing('north', 'south', 25, 15), pairing('south', 'north', 10, 30)])).toThrow(
      /two pairings/u,
    );
  });

  it('refuses an empty pairings list', () => {
    expect(() => table([])).toThrow();
  });
});

describe('counting decided games', () => {
  it('excludes clock draws but not rules draws', () => {
    const rates = table([pairing('north', 'south', 20, 15, 3, 2)]);
    expect(headToHeadDecidedGames(rates.pairings[0]!)).toBe(38);
  });
});

describe('narrowing a table to the decks one format carries', () => {
  const rates = table([
    pairing('north', 'south', 25, 15),
    pairing('north', 'nowhere', 10, 10),
    pairing('south', 'nowhere', 12, 8),
  ]);

  it('keeps only the pairings between carried decks', () => {
    const narrowed = headToHeadForDecks(rates, [deck('north'), deck('south')]);
    expect(narrowed?.pairings.map((entry) => [entry.a, entry.b])).toEqual([['north', 'south']]);
  });

  it('has nothing to say about a format whose decks share no measured pairing', () => {
    expect(headToHeadForDecks(rates, [deck('nowhere'), deck('elsewhere')])).toBeUndefined();
  });
});

describe('ranking opponents by how close their head-to-head share is to even', () => {
  const rates = table([
    pairing('north', 'south', 25, 15),
    pairing('north', 'east', 22, 18),
    pairing('north', 'west', 5, 35),
    pairing('north', 'thin', 8, 7),
  ]);

  it('puts the closest-to-even measured deck first and states each side of the record', () => {
    const ranking = rankHeadToHeadByCloseness(
      deck('north'),
      [deck('west'), deck('south'), deck('east'), deck('thin')],
      rates,
    );
    expect(ranking.map((entry) => entry.deck.id)).toEqual(['east', 'south', 'west', 'thin']);
    const east = ranking[0]!;
    if (!east.measured) throw new Error('expected east to be measured');
    expect(east.decided).toBe(40);
    expect(east.mineWins).toBe(22);
    expect(east.opponentWins).toBe(18);
    expect(east.mineShare).toBeCloseTo(0.55, 10);
    const thin = ranking[3]!;
    expect(thin.measured).toBe(false);
  });

  it('treats a missing pairing the same as too few decided games', () => {
    const ranking = rankHeadToHeadByCloseness(deck('north'), [deck('unseen')], rates);
    expect(ranking).toEqual([{ measured: false, deck: deck('unseen') }]);
  });

  it(`requires at least ${String(HEAD_TO_HEAD_MINIMUM_DECIDED_GAMES)} decided games before showing a share`, () => {
    const borderline = table([pairing('north', 'under', 9, 10), pairing('north', 'over', 10, 10)]);
    const ranking = rankHeadToHeadByCloseness(deck('north'), [deck('under'), deck('over')], borderline);
    expect(ranking.find((entry) => entry.deck.id === 'under')?.measured).toBe(false);
    expect(ranking.find((entry) => entry.deck.id === 'over')?.measured).toBe(true);
  });

  it('reads the share from whichever side of the pairing names my deck', () => {
    const mirrored = table([pairing('south', 'north', 15, 25)]);
    const ranking = rankHeadToHeadByCloseness(deck('north'), [deck('south')], mirrored);
    const south = ranking[0]!;
    if (!south.measured) throw new Error('expected south to be measured');
    expect(south.mineWins).toBe(25);
    expect(south.opponentWins).toBe(15);
    expect(south.mineShare).toBeCloseTo(0.625, 10);
  });

  it('keeps equally close decks in the order they arrived in', () => {
    const level = table([
      pairing('mid', 'above', 30, 10),
      pairing('mid', 'below', 10, 30),
      pairing('mid', 'same', 20, 20),
    ]);
    const forward = rankHeadToHeadByCloseness(
      deck('mid'),
      [deck('above'), deck('below'), deck('same')],
      level,
    );
    const backward = rankHeadToHeadByCloseness(
      deck('mid'),
      [deck('below'), deck('above'), deck('same')],
      level,
    );
    expect(forward.map((entry) => entry.deck.id)).toEqual(['same', 'above', 'below']);
    expect(backward.map((entry) => entry.deck.id)).toEqual(['same', 'below', 'above']);
  });

  it('lists unmeasured decks in name order after every measured one', () => {
    const ranking = rankHeadToHeadByCloseness(
      deck('north'),
      [deck('zulu', 'Zulu'), deck('east'), deck('alpha', 'Alpha')],
      rates,
    );
    expect(ranking.map((entry) => entry.deck.id)).toEqual(['east', 'alpha', 'zulu']);
  });
});
