import { describe, expect, it } from 'vitest';
import {
  cardsSeenBy,
  colorsOf,
  gameFacts,
  isInertTurn,
  landsInPlayAt,
  otherSide,
  ownTurn,
  ownTurns,
  roundsFromPlayerTurns,
} from '@mtg/metrics';
import { fakeLog } from './helpers/log';

describe('roundsFromPlayerTurns', () => {
  it('converts the kernel global turn counter to 17lands-comparable rounds', () => {
    // The kernel numbers turns globally (turn 1 is the starting player's, turn
    // 2 the opponent's); 17lands' num_turns counts each player's own turns.
    expect(roundsFromPlayerTurns(1)).toBe(1);
    expect(roundsFromPlayerTurns(2)).toBe(1);
    expect(roundsFromPlayerTurns(17)).toBe(9);
    expect(roundsFromPlayerTurns(18)).toBe(9);
  });
});

describe('gameFacts', () => {
  it('reads the winner, the play seat and both color strings off the log', () => {
    const facts = gameFacts(
      fakeLog({ playerTurns: 15, winner: 1, onPlay: 1, userColors: 'WU', oppoColors: 'BR' }),
    );
    expect(facts.winner).toBe('oppo');
    expect(facts.onPlay).toBe('oppo');
    expect(facts.userColors).toBe('WU');
    expect(facts.oppoColors).toBe('BR');
    expect(facts.playerTurns).toBe(15);
    expect(facts.rounds).toBe(8);
    expect(facts.mirror).toBe(false);
  });

  it('reports a draw as no winner', () => {
    const facts = gameFacts(fakeLog({ playerTurns: 40, winner: null, endReason: 'turnLimit' }));
    expect(facts.winner).toBeNull();
    expect(facts.endReason).toBe('turnLimit');
  });

  it('flags a mirror', () => {
    expect(gameFacts(fakeLog({ playerTurns: 8, userColors: 'WU', oppoColors: 'WU' })).mirror).toBe(true);
  });

  it('reads colors by side', () => {
    const facts = gameFacts(fakeLog({ playerTurns: 8, userColors: 'GW', oppoColors: 'UB' }));
    expect(colorsOf(facts, 'user')).toBe('GW');
    expect(colorsOf(facts, otherSide('user'))).toBe('UB');
  });
});

describe('own-turn ordinals', () => {
  it("maps a side's Nth turn to the right global turn when it is on the play", () => {
    const log = fakeLog({ playerTurns: 10, onPlay: 0 });
    expect(ownTurns(log, 'user').map((record) => record.turn)).toEqual([1, 3, 5, 7, 9]);
    expect(ownTurns(log, 'oppo').map((record) => record.turn)).toEqual([2, 4, 6, 8, 10]);
    expect(ownTurn(log, 'user', 4)?.turn).toBe(7);
  });

  it('maps them the other way round when it is on the draw', () => {
    const log = fakeLog({ playerTurns: 10, onPlay: 1 });
    expect(ownTurns(log, 'user').map((record) => record.turn)).toEqual([2, 4, 6, 8, 10]);
    expect(ownTurn(log, 'user', 4)?.turn).toBe(8);
  });

  it('returns undefined rather than zero when the game ended first', () => {
    const log = fakeLog({ playerTurns: 5 });
    expect(ownTurn(log, 'user', 4)).toBeUndefined();
    expect(landsInPlayAt(log, 'user', 4)).toBeUndefined();
    expect(ownTurn(log, 'user', 0)).toBeUndefined();
  });

  it("reads lands in play off the side's own turn, not the global one", () => {
    const log = fakeLog({ playerTurns: 12, onPlay: 0, userLands: [1, 2, 2, 3, 4, 5] });
    expect(landsInPlayAt(log, 'user', 3)).toBe(2);
    expect(landsInPlayAt(log, 'user', 4)).toBe(3);
    expect(landsInPlayAt(log, 'oppo', 4)).toBe(4);
  });
});

describe('isInertTurn', () => {
  it('is false for a turn that developed the board', () => {
    const log = fakeLog({ playerTurns: 4 });
    const first = log.turns[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(isInertTurn(first)).toBe(false);
  });

  it('is true when nothing was played, cast or attacked with', () => {
    const log = fakeLog({ playerTurns: 6, inertTurns: [5], userLands: [1, 2, 2] });
    const fifth = log.turns.find((record) => record.turn === 5);
    expect(fifth).toBeDefined();
    if (fifth === undefined) return;
    expect(isInertTurn(fifth)).toBe(true);
  });
});

describe('cardsSeenBy', () => {
  it('skips the first draw for the player on the play', () => {
    expect(cardsSeenBy(1, true)).toBe(7);
    expect(cardsSeenBy(1, false)).toBe(8);
    expect(cardsSeenBy(4, true)).toBe(10);
    expect(cardsSeenBy(4, false)).toBe(11);
  });
});
