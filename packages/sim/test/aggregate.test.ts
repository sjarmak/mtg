/**
 * Aggregation and fixture-deck tests.
 *
 * The aggregate is what the balance CI asserts against, so its arithmetic is
 * checked against hand-built outcomes rather than only against whatever a run
 * happens to produce.
 */
import { describe, expect, it } from 'vitest';
import { cardManaValue } from '@mtg/dsl';
import type { GameOutcome } from '@mtg/sim';
import {
  aggregateOutcomes,
  DEFAULT_DECK_SIZE,
  DEFAULT_LAND_COUNT,
  decidedWinRate,
  deckColorString,
  FIXTURE_DECK_RW,
  FIXTURE_DECK_UB,
  fixtureDeck,
} from '@mtg/sim';

function outcome(index: number, winner: 0 | 1 | null, startingPlayer: 0 | 1, turns: number): GameOutcome {
  return {
    index,
    seed: `seed/${index}`,
    startingPlayer,
    winner,
    reason: winner === null ? 'turnLimit' : 'lifeZero',
    turns,
    decisions: 100 + index,
    log: null,
    events: null,
    triggerCensus: null,
    activationCensus: null,
  };
}

describe('aggregation', () => {
  const outcomes: readonly GameOutcome[] = [
    outcome(0, 0, 0, 8),
    outcome(1, 1, 1, 10),
    outcome(2, 0, 1, 12),
    outcome(3, null, 0, 40),
  ];
  const aggregate = aggregateOutcomes('run', outcomes);

  it('counts wins, draws and end reasons', () => {
    expect(aggregate.games).toBe(4);
    expect(aggregate.wins).toEqual([2, 1]);
    expect(aggregate.draws).toBe(1);
    expect(aggregate.endReasons).toEqual({ lifeZero: 3, emptyLibrary: 0, concede: 0, turnLimit: 1 });
  });

  it('measures on-play win rate over decided games only', () => {
    // Games 0 and 1 were won by whoever was on the play; game 2 was not.
    expect(aggregate.onPlayGames).toBe(3);
    expect(aggregate.onPlayWins).toBe(2);
    expect(aggregate.onPlayWinRate).toBeCloseTo(2 / 3, 10);
  });

  it('summarizes game length', () => {
    expect(aggregate.meanTurns).toBeCloseTo(17.5, 10);
    expect(aggregate.medianTurns).toBe(11);
    expect(aggregate.minTurns).toBe(8);
    expect(aggregate.maxTurns).toBe(40);
    expect(aggregate.turnHistogram[8]).toBe(1);
    expect(aggregate.turnHistogram[40]).toBe(1);
    expect(aggregate.turnHistogram.reduce((sum, value) => sum + value, 0)).toBe(4);
  });

  it('reports win rate over decided games separately from raw share', () => {
    expect(aggregate.winRate[0]).toBeCloseTo(0.5, 10);
    expect(decidedWinRate(aggregate, 0)).toBeCloseTo(2 / 3, 10);
  });

  it('handles an empty run without dividing by zero', () => {
    const empty = aggregateOutcomes('run', []);
    expect(empty.games).toBe(0);
    expect(empty.meanTurns).toBe(0);
    expect(empty.onPlayWinRate).toBe(0);
  });
});

describe('fixture decks', () => {
  it('builds a 40-card, 17-land deck', () => {
    for (const deck of [FIXTURE_DECK_RW, FIXTURE_DECK_UB]) {
      expect(deck.cards).toHaveLength(DEFAULT_DECK_SIZE);
      expect(deck.cards.filter((card) => card.kind === 'land')).toHaveLength(DEFAULT_LAND_COUNT);
    }
  });

  it("only includes cards castable in the deck's colors", () => {
    const deck = fixtureDeck('mono green', ['G']);
    for (const card of deck.cards) {
      if (card.kind === 'land') continue;
      expect(card.colors.every((color) => color === 'G')).toBe(true);
    }
  });

  it("splits basics across the deck's colors", () => {
    const lands = FIXTURE_DECK_RW.cards.filter((card) => card.kind === 'land');
    const types = new Set(lands.map((card) => (card.kind === 'land' ? card.basicLandType : '')));
    expect(types).toEqual(new Set(['Mountain', 'Plains']));
  });

  it("reports colors in WUBRG order for the log's main_colors", () => {
    expect(deckColorString(FIXTURE_DECK_RW)).toBe('WR');
    expect(deckColorString(FIXTURE_DECK_UB)).toBe('UB');
  });

  it('keeps a playable curve', () => {
    const spells = FIXTURE_DECK_RW.cards.filter((card) => card.kind !== 'land');
    const average = spells.reduce((sum, card) => sum + cardManaValue(card), 0) / spells.length;
    expect(average).toBeGreaterThan(1);
    expect(average).toBeLessThan(5);
  });

  it('refuses impossible deck shapes loudly', () => {
    expect(() => fixtureDeck('nothing', [])).toThrowError(/at least one color/);
    expect(() => fixtureDeck('all lands', ['G'], { size: 17, lands: 17 })).toThrowError(/room for spells/);
  });
});
