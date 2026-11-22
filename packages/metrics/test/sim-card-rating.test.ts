import { describe, expect, it } from 'vitest';
import { BASIC_LANDS, exampleCard } from '@mtg/dsl';
import { metricsConfig, simCardRatings } from '@mtg/metrics';
import { cardStats, matchup } from './helpers/log';

const config = metricsConfig({ floors: { card: 4 } });

const sentinel = exampleCard('slc-skywatch-sentinel'); // 'Skywatch Sentinel'
const charge = exampleCard('slc-radiant-charge'); // 'Radiant Charge'
const cleric = exampleCard('slc-lifebound-cleric'); // 'Lifebound Cleric'
const [plains] = BASIC_LANDS;
if (plains === undefined) throw new Error('BASIC_LANDS is empty');

/**
 * Eight games, WU winning six. Charge is only in the four winning-heavy games
 * (4-0, winRate 1.0), Cleric only in the other four (2-2, winRate 0.5),
 * Sentinel and the land are in every game (6-2, winRate 0.75). Cleric ends up
 * the low end of the band and Charge the high end, both distinct from
 * Sentinel's midpoint reading.
 */
function ratedLogs() {
  return matchup('WU', 'BR', 8, 6, { playerTurns: 16 }, (index) => ({
    cards: {
      'Skywatch Sentinel': cardStats({ deck: 17, drawn: 1 }),
      Plains: cardStats({ deck: 8, drawn: 1 }),
      ...(index < 4
        ? { 'Radiant Charge': cardStats({ deck: 17, drawn: 1 }) }
        : { 'Lifebound Cleric': cardStats({ deck: 17, drawn: 1 }) }),
    },
  }));
}

function find(ratings: ReturnType<typeof simCardRatings>, name: string) {
  const found = ratings.find((entry) => entry.card.name === name);
  expect(found).toBeDefined();
  return found;
}

describe('simCardRatings', () => {
  it('min-max scales measured win rate onto the [0, 5] band', () => {
    const ratings = simCardRatings([sentinel, charge, cleric], ratedLogs(), config);
    expect(find(ratings, 'Lifebound Cleric')?.simRating).toBe(0);
    expect(find(ratings, 'Skywatch Sentinel')?.simRating).toBe(2.5);
    expect(find(ratings, 'Radiant Charge')?.simRating).toBe(5);
  });

  it('stamps every rating as play-data, carrying the measured win rate', () => {
    const ratings = simCardRatings([sentinel, charge, cleric], ratedLogs(), config);
    for (const rated of ratings) {
      expect(rated.source).toBe('play-data');
      if (rated.source !== 'play-data') continue;
      expect(rated.winRate).toBeGreaterThan(0);
      expect(rated.winRate).toBeLessThanOrEqual(1);
    }
  });

  it('excludes lands even when their win rate clears the floor', () => {
    const ratings = simCardRatings([sentinel, plains], ratedLogs(), config);
    expect(ratings.some((entry) => entry.card.name === 'Plains')).toBe(false);
  });

  it('excludes a card the logs never saw at all', () => {
    const logs = matchup('WU', 'BR', 8, 6, { playerTurns: 16 }, () => ({
      cards: { 'Skywatch Sentinel': cardStats({ deck: 17, drawn: 1 }) },
    }));
    const ratings = simCardRatings([sentinel, cleric], logs, config);
    expect(ratings).toHaveLength(1);
    expect(ratings[0]?.card.name).toBe('Skywatch Sentinel');
  });

  it('falls back to the midpoint when every evidenced card shares one win rate', () => {
    const logs = matchup('WU', 'BR', 8, 6, { playerTurns: 16 }, () => ({
      cards: {
        'Skywatch Sentinel': cardStats({ deck: 17, drawn: 1 }),
        'Radiant Charge': cardStats({ deck: 17, drawn: 1 }),
      },
    }));
    const ratings = simCardRatings([sentinel, charge], logs, config);
    expect(find(ratings, 'Skywatch Sentinel')?.simRating).toBe(2.5);
    expect(find(ratings, 'Radiant Charge')?.simRating).toBe(2.5);
  });

  it('returns nothing when no card clears the floor', () => {
    const logs = matchup('WU', 'BR', 2, 1, { playerTurns: 16 }, () => ({
      cards: { 'Skywatch Sentinel': cardStats({ deck: 17, drawn: 1 }) },
    }));
    expect(simCardRatings([sentinel], logs, config)).toEqual([]);
  });
});
