import { describe, expect, it } from 'vitest';
import { cardWinRatesWhenDrawn, metricsConfig } from '@mtg/metrics';
import { cardStats, fakeLog, matchup, repeatedGame } from './helpers/log';

const config = metricsConfig({ floors: { card: 4 } });

function find(records: ReturnType<typeof cardWinRatesWhenDrawn>, name: string) {
  const found = records.find((entry) => entry.cardName === name);
  expect(found).toBeDefined();
  return found;
}

describe('cardWinRatesWhenDrawn', () => {
  it('credits a win or a loss to every game a card was seen in', () => {
    const logs = matchup('WU', 'BR', 8, 5, { playerTurns: 16 }, () => ({
      cards: { 'Skywatch Sentinel': cardStats({ deck: 17, opening_hand: 1 }) },
    }));
    const sentinel = find(cardWinRatesWhenDrawn(logs, config), 'Skywatch Sentinel');
    expect(sentinel?.wins).toBe(5);
    expect(sentinel?.losses).toBe(3);
    expect(sentinel?.gamesInHand).toBe(8);
    expect(sentinel?.winRate.value).toBe(0.625);
  });

  it('sums opening-hand and later-drawn sightings into gamesInHand', () => {
    const logs = matchup('WU', 'BR', 4, 4, { playerTurns: 16 }, (index) => ({
      cards: {
        'Radiant Charge': cardStats({ deck: 17, opening_hand: index < 2 ? 1 : 0, drawn: index < 2 ? 0 : 1 }),
      },
    }));
    const charge = find(cardWinRatesWhenDrawn(logs, config), 'Radiant Charge');
    expect(charge?.gamesInHand).toBe(4);
    expect(charge?.wins).toBe(4);
  });

  it('only counts a game toward a card the game actually saw', () => {
    const logs = matchup('WU', 'BR', 4, 2, { playerTurns: 16 }, (index) => ({
      cards: index < 2 ? { 'Radiant Charge': cardStats({ deck: 17, drawn: 1 }) } : {},
    }));
    const charge = find(cardWinRatesWhenDrawn(logs, config), 'Radiant Charge');
    expect(charge?.gamesInHand).toBe(2);
  });

  it('excludes a drawn game entirely, not just from the win-rate denominator', () => {
    const logs = [
      ...matchup('WU', 'BR', 4, 4, { playerTurns: 16 }, () => ({
        cards: { 'Radiant Charge': cardStats({ deck: 17, drawn: 1 }) },
      })),
      fakeLog({
        index: 100,
        userColors: 'WU',
        oppoColors: 'BR',
        playerTurns: 40,
        winner: null,
        endReason: 'turnLimit',
        variant: 7,
        cards: { 'Radiant Charge': cardStats({ deck: 17, drawn: 1 }) },
      }),
    ];
    const charge = find(cardWinRatesWhenDrawn(logs, config), 'Radiant Charge');
    expect(charge?.gamesInHand).toBe(4);
    expect(charge?.wins).toBe(4);
    expect(charge?.losses).toBe(0);
  });

  it('withholds a win rate for a card below its sample floor', () => {
    const logs = matchup('WU', 'BR', 3, 2, { playerTurns: 16 }, () => ({
      cards: { 'Radiant Charge': cardStats({ deck: 17, drawn: 1 }) },
    }));
    const charge = find(cardWinRatesWhenDrawn(logs, config), 'Radiant Charge');
    expect(charge?.winRate.value).toBeNull();
    expect(charge?.winRate.underSampled).toBe(true);
  });

  it('counts distinct trajectories, so replaying one game does not clear the floor', () => {
    const logs = repeatedGame(500, {
      userColors: 'WU',
      oppoColors: 'BR',
      playerTurns: 16,
      cards: { 'Radiant Charge': cardStats({ deck: 17, drawn: 1 }) },
    });
    const charge = find(cardWinRatesWhenDrawn(logs, config), 'Radiant Charge');
    expect(charge?.gamesInHand).toBe(500);
    expect(charge?.winRate.distinctSamples).toBe(1);
    expect(charge?.winRate.value).toBeNull();
  });

  it('sorts records by card name', () => {
    const logs = matchup('WU', 'BR', 4, 4, { playerTurns: 16 }, () => ({
      cards: {
        'Zephyr Scout': cardStats({ deck: 17, drawn: 1 }),
        'Ashfall Recruit': cardStats({ deck: 17, drawn: 1 }),
      },
    }));
    const names = cardWinRatesWhenDrawn(logs, config).map((entry) => entry.cardName);
    expect(names).toEqual(['Ashfall Recruit', 'Zephyr Scout']);
  });
});
