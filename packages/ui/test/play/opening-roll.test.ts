import { describe, expect, it } from 'vitest';
import {
  D20_FACES,
  finalRound,
  openingRollText,
  rollForFirst,
  tieText,
} from '../../src/routes/play/opening-roll';

describe('rollForFirst', () => {
  it('is a function of the seed alone', () => {
    expect(rollForFirst('lab/sealed/v0')).toEqual(rollForFirst('lab/sealed/v0'));
  });

  it('rolls a d20 for each seat and ends on a round that is not a tie', () => {
    for (let n = 0; n < 200; n += 1) {
      const roll = rollForFirst(`seed-${String(n)}`);
      for (const [a, b] of roll.rounds) {
        expect(a).toBeGreaterThanOrEqual(1);
        expect(a).toBeLessThanOrEqual(D20_FACES);
        expect(b).toBeGreaterThanOrEqual(1);
        expect(b).toBeLessThanOrEqual(D20_FACES);
      }
      const [a, b] = finalRound(roll);
      expect(a).not.toBe(b);
      expect(roll.winner).toBe(a > b ? 0 : 1);
      for (const earlier of roll.rounds.slice(0, -1)) expect(earlier[0]).toBe(earlier[1]);
    }
  });

  it('lets either seat win across seeds', () => {
    const winners = new Set<number>();
    for (let n = 0; n < 50; n += 1) winners.add(rollForFirst(`w-${String(n)}`).winner);
    expect(winners).toEqual(new Set([0, 1]));
  });

  it('finds a seed that ties at least once and narrates the tie', () => {
    let tied = null;
    for (let n = 0; n < 2000 && tied === null; n += 1) {
      const roll = rollForFirst(`tie-${String(n)}`);
      if (roll.rounds.length > 1) tied = roll;
    }
    expect(tied).not.toBeNull();
    expect(openingRollText(tied!, ['You', 'Bot'])).toMatch(/after (one tie|\d+ ties) and/);
    expect(tieText(tied!.rounds[0]!)).toMatch(/^Tied at \d+\. Rolling again\.$/);
  });
});

describe('openingRollText', () => {
  it('speaks to the human in the second person and of the bot in the third', () => {
    expect(openingRollText({ rounds: [[17, 4]], winner: 0 }, ['You', 'Bot'])).toBe(
      'You won the die roll 17 to 4 and play first.',
    );
    expect(openingRollText({ rounds: [[3, 12]], winner: 1 }, ['You', 'Bot'])).toBe(
      'Bot won the die roll 12 to 3 and plays first.',
    );
  });
});
