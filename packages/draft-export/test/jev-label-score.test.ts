/**
 * The study's arithmetic, on inputs small enough to check by hand.
 *
 * Every function here answers a question the bead asks, so each test states the
 * question it stands for. The recurring trap is a statistic that is undefined on
 * degenerate input (no spread, no pairs): those return `NaN` or `null` and the
 * tests hold them to it, because a `0` would read as "no correlation found".
 */
import { describe, expect, it } from 'vitest';
import { formatReport } from '../tools/jev-label/report';
import {
  agreement,
  cardLevel,
  cardLifts,
  disagreement,
  primaryViews,
  stability,
  viewOf,
} from '../tools/jev-label/score';
import type { CardBenchmark, DecisionView } from '../tools/jev-label/score';
import { averageRanks, bootstrapInterval, mean, pearson, spearman } from '../tools/jev-label/stats';
import { decisionsOf, recordOf } from './jev-label-fixture';

describe('the statistics', () => {
  it('averages ranks over ties', () => {
    expect(averageRanks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
    expect(averageRanks([])).toEqual([]);
  });

  it('gives a rank correlation of 1 to any increasing relationship and -1 to a decreasing one', () => {
    expect(spearman([1, 2, 3, 4], [1, 10, 100, 1000])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [9, 7, 3, 0])).toBeCloseTo(-1);
  });

  it('has no correlation for a column without spread, rather than zero', () => {
    expect(spearman([1, 2, 3], [5, 5, 5])).toBeNaN();
    expect(spearman([1], [1])).toBeNaN();
    expect(mean([])).toBeNaN();
  });

  it('refuses two columns of different lengths', () => {
    expect(() => pearson([1, 2], [1])).toThrow(/same length/);
  });

  it('draws the same bootstrap for the same seed, a different one for another, and none for one row', () => {
    const rows = [3, 1, 4, 1, 5, 9, 2, 6];
    const average = (indexes: readonly number[]): number =>
      mean(indexes.map((index) => rows[index] as number));
    const first = bootstrapInterval(rows.length, average, 'seed-a');
    expect(bootstrapInterval(rows.length, average, 'seed-a')).toEqual(first);
    expect(bootstrapInterval(rows.length, average, 'seed-b')).not.toEqual(first);
    expect(first?.low).toBeLessThan(mean(rows));
    expect(first?.high).toBeGreaterThan(mean(rows));
    expect(bootstrapInterval(1, average, 'seed-a')).toBeNull();
  });

  it('reports no interval when the statistic is undefined on most resamples', () => {
    expect(bootstrapInterval(5, () => Number.NaN, 'seed-a')).toBeNull();
  });
});

describe('reading a stored answer as a decision', () => {
  const decision = decisionsOf(1)[0]!;
  const ids = decision.pack.map((card) => card.id);

  it('accepts a well formed answer', () => {
    const view = viewOf(recordOf(decision, 0, { favor: ids[1]! }));
    expect(view.choice).toBe(ids[1]);
    expect(view.probabilities.size).toBe(ids.length);
  });

  it('refuses an answer that scores a card that was not in the pack', () => {
    const probabilities = Object.fromEntries([
      ...ids.slice(1).map((id) => [id, 0.5 / (ids.length - 1)]),
      ['stray', 0.5],
    ]);
    expect(() => viewOf(recordOf(decision, 0, { probabilities }))).toThrow(/stray/);
  });

  it('refuses an answer that leaves an option unscored', () => {
    const probabilities = Object.fromEntries(ids.slice(1).map((id) => [id, 1 / (ids.length - 1)]));
    expect(() => viewOf(recordOf(decision, 0, { probabilities, choice: ids[1]! }))).toThrow(
      new RegExp(`scored ${String(ids.length - 1)} of ${String(ids.length)}`),
    );
  });

  it('refuses probabilities that do not sum to one, and a choice outside the pack', () => {
    const probabilities = Object.fromEntries(ids.map((id) => [id, 0.5]));
    expect(() => viewOf(recordOf(decision, 0, { probabilities }))).toThrow(/sum to/);
    expect(() => viewOf(recordOf(decision, 0, { choice: 'stray' }))).toThrow(/not in the pack/);
  });

  it('takes one primary answer per decision and ignores the repeats', () => {
    const [first, second] = decisionsOf(2);
    const records = [recordOf(first!, 0), recordOf(second!, 0), recordOf(first!, 1)];
    expect(primaryViews(records).map((view) => view.key)).toEqual([first!.key, second!.key]);
    expect(() => primaryViews([recordOf(first!, 0), recordOf(first!, 0)])).toThrow(/two primary answers/);
  });
});

describe('agreement with the bot', () => {
  const decisions = decisionsOf(4);

  it('counts a decision as agreeing when the labeler chose the card the bot took', () => {
    const views = primaryViews(
      decisions.map((decision, index) => {
        const other = decision.pack.find((card) => card.id !== decision.botPickId)!.id;
        return recordOf(decision, 0, { favor: index < 2 ? decision.botPickId : other });
      }),
    );
    const report = agreement(views);

    expect(report.decisions).toBe(4);
    expect(report.top1).toBe(0.5);
    expect(report.chanceTop1).toBeCloseTo(mean(decisions.map((decision) => 1 / decision.pack.length)));
    expect(report.botPickLift).toBeGreaterThan(1);
    expect(report.meanTopProbability).toBe(0.5);
    expect(report.meanConfidence).toBe(0.6);
  });

  it('has a lift near one when the labeler puts the bot card no higher than the rest', () => {
    const views = primaryViews(
      decisions.map((decision) => {
        const uniform = Object.fromEntries(decision.pack.map((card) => [card.id, 1 / decision.pack.length]));
        return recordOf(decision, 0, { probabilities: uniform, choice: decision.pack[0]!.id });
      }),
    );
    expect(agreement(views).botPickLift).toBeCloseTo(1);
  });
});

describe('repeat stability', () => {
  const decisions = decisionsOf(3);

  it('compares a repeat with its own first answer and counts only decisions that have both', () => {
    const [a, b, c] = decisions;
    const otherThan = (card: (typeof decisions)[number]): string => card.pack[card.pack.length - 1]!.id;
    const answers = [
      recordOf(a!, 0),
      recordOf(b!, 0),
      recordOf(c!, 0),
      recordOf(a!, 1),
      recordOf(b!, 1, { favor: otherThan(b!) }),
      recordOf(decisionsOf(1, 'other/pod/0')[0]!, 1),
    ];
    const report = stability(answers);

    expect(report.pairs).toBe(2);
    expect(report.sameChoice).toBe(1);
    expect(report.identicalVectors).toBe(1);
    expect(report.meanTotalVariation).toBeGreaterThan(0);
    expect(report.meanTotalVariation).toBeLessThan(1);
    expect(report.meanRankCorrelation).toBeLessThan(1);
  });

  it('reports nothing measurable when no decision was asked twice', () => {
    const report = stability([recordOf(decisions[0]!, 0)]);
    expect(report.pairs).toBe(0);
    expect(report.meanTotalVariation).toBeNaN();
  });
});

function view(
  key: string,
  ids: readonly string[],
  probabilities: readonly number[],
  botPickId: string,
): DecisionView {
  return {
    key,
    packIds: ids,
    botPickId,
    choice: ids[probabilities.indexOf(Math.max(...probabilities))]!,
    probabilities: new Map(ids.map((id, index) => [id, probabilities[index]!])),
    confidence: null,
  };
}

describe('does the probability predict strength', () => {
  const ids = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
  const rising = [0.02, 0.05, 0.1, 0.15, 0.25, 0.43];
  const views = Array.from({ length: 5 }, (_unused, index) => view(`k${String(index)}`, ids, rising, 'c1'));

  it("averages a card's lift over every pack it appeared in", () => {
    const lifts = cardLifts(views);
    expect(lifts).toHaveLength(6);
    expect(lifts.find((lift) => lift.cardId === 'c6')).toMatchObject({ appearances: 5 });
    expect(lifts.find((lift) => lift.cardId === 'c6')?.meanLift).toBeCloseTo(0.43 * 6);
  });

  it('scores a labeler that ranks like the balance harness against the deck builder that ranks against it', () => {
    const benchmarks: CardBenchmark[] = ids.map((cardId, index) => ({
      cardId,
      strength: index / 10,
      rating: 5 - index,
    }));
    const report = cardLevel(views, benchmarks, 5);

    expect(report.cards).toBe(6);
    expect(report.jevVsStrength.rho).toBeCloseTo(1);
    expect(report.ratingVsStrength.rho).toBeCloseTo(-1);
    expect(report.jevVsRating).toBeCloseTo(-1);
    expect(report.advantage.value).toBeCloseTo(2);
    expect(report.jevVsStrength.interval?.low).toBeCloseTo(1);
    expect(report.advantage.interval?.low).toBeCloseTo(2);
  });

  it('leaves out a card with no strength estimate and a card seen too rarely', () => {
    const benchmarks: CardBenchmark[] = ids.map((cardId, index) => ({
      cardId,
      strength: cardId === 'c2' ? null : index / 10,
      rating: index,
    }));
    const report = cardLevel(
      [...views, view('rare', ['c1', 'c9'], [0.5, 0.5], 'c1')],
      [...benchmarks, { cardId: 'c9', strength: 0.9, rating: 1 }],
      5,
    );
    expect(report.cards).toBe(5);
  });

  it('reports no correlation when nothing clears the appearance floor', () => {
    const report = cardLevel(
      views.slice(0, 2),
      ids.map((cardId, index) => ({ cardId, strength: index, rating: index })),
      5,
    );
    expect(report.cards).toBe(0);
    expect(report.jevVsStrength.rho).toBeNaN();
    expect(report.jevVsStrength.interval).toBeNull();
  });
});

describe('where the labeler and the bot disagree', () => {
  const strengths = new Map([
    ['a', 0.5],
    ['b', 0.2],
    ['c', 0.1],
  ]);
  const ids = ['a', 'b', 'c'];

  it('compares the strength of the two cards, only on decisions where they differ and both are known', () => {
    const views = [
      view('agree', ids, [0.6, 0.3, 0.1], 'a'),
      view('jev-better', ids, [0.6, 0.3, 0.1], 'b'),
      view('bot-better', ids, [0.1, 0.3, 0.6], 'a'),
      view('unknown', [...ids, 'z'], [0.1, 0.1, 0.1, 0.7], 'a'),
    ];
    const report = disagreement(views, strengths);

    expect(report.decisions).toBe(2);
    expect(report.jevStronger).toBe(1);
    expect(report.meanStrengthDelta).toBeCloseTo((0.5 - 0.2 + (0.1 - 0.5)) / 2);
  });
});

describe('the printed report', () => {
  it('prints n/a for anything undefined, says what was not measured, and never prints NaN', () => {
    const decisions = decisionsOf(2);
    const views = primaryViews(decisions.map((decision) => recordOf(decision, 0)));
    const text = formatReport({
      agreement: agreement(views),
      stability: stability([]),
      cardLevel: cardLevel(views, [], 5),
      disagreement: disagreement(views, new Map()),
    });

    expect(text).toContain('n/a');
    expect(text).not.toContain('NaN');
    expect(text).toContain('(b) agreement with human picks: not measured');
    expect(text).toContain('decisions asked twice: 0');
  });
});
