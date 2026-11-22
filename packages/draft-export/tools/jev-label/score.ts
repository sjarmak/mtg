/**
 * Scoring the recorded answers: the three tests `mtg-h76gz.2` asks for, computed
 * from the record file alone so no number needs another call.
 *
 * (a) Does Jev's per-option probability predict draft-deck strength? Answered
 *     at the card, because a deck's win rate is not a property of one pick.
 *     Jev's *lift* for a card (its probability times the pack size, so 1 is "no
 *     opinion") is averaged over every pack the card appeared in, and ranked
 *     against the balance harness's own per-card strength estimate
 *     (`@mtg/metrics` draft campaign: a within-deck, within-opponent
 *     drawn-versus-not-drawn association, which claims association and not
 *     causal card power). The bar Jev has to clear is the deck builder's rating
 *     against the same estimate, on the same cards, with a paired bootstrap on
 *     the difference. A second read looks only at decisions where Jev and the
 *     bot disagree and asks whose card is the stronger one.
 * (b) Agreement with human picks needs human pick data; this checkout holds one
 *     case. Nothing here fabricates it. `agreement` reports agreement with the
 *     *bot*, which is a baseline and is not error.
 * (c) Repeat stability, from the second call made on a sample of decisions.
 */
import type { AnswerRecord } from './record';
import { answerView } from './record';
import type { Interval } from './stats';
import { bootstrapInterval, mean, spearman } from './stats';

export interface DecisionView {
  readonly key: string;
  readonly packIds: readonly string[];
  readonly botPickId: string;
  readonly choice: string;
  readonly probabilities: ReadonlyMap<string, number>;
  readonly confidence: number | null;
}

/** Probabilities are rounded to two places, so a pack of 15 can sum a few points off one. */
const SUM_TOLERANCE = 0.1;

export function viewOf(record: AnswerRecord): DecisionView {
  const answer = answerView(record);
  const options = new Set(record.packIds);
  const probabilities = new Map(Object.entries(answer.probabilities));
  for (const id of probabilities.keys()) {
    if (!options.has(id)) throw new Error(`${record.key}: Jev scored ${id}, which was not in the pack`);
  }
  if (probabilities.size !== options.size) {
    throw new Error(
      `${record.key}: Jev scored ${String(probabilities.size)} of ${String(options.size)} options`,
    );
  }
  const total = [...probabilities.values()].reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > SUM_TOLERANCE) {
    throw new Error(`${record.key}: probabilities sum to ${total.toFixed(2)}, not 1`);
  }
  if (!options.has(answer.choice))
    throw new Error(`${record.key}: Jev chose ${answer.choice}, which was not in the pack`);
  return {
    key: record.key,
    packIds: record.packIds,
    botPickId: record.botPickId,
    choice: answer.choice,
    probabilities,
    confidence: answer.confidence,
  };
}

/** One view per decision, from its primary (repeat 0) answer. */
export function primaryViews(answers: readonly AnswerRecord[]): readonly DecisionView[] {
  const seen = new Set<string>();
  return answers
    .filter((record) => record.repeat === 0)
    .map((record) => {
      if (seen.has(record.key)) throw new Error(`${record.key} has two primary answers`);
      seen.add(record.key);
      return viewOf(record);
    });
}

export interface AgreementReport {
  readonly decisions: number;
  /** Share of decisions where Jev's choice is the card the bot took. */
  readonly top1: number;
  /** What agreement would be if Jev chose uniformly: the mean of 1 / pack size. */
  readonly chanceTop1: number;
  /** Jev's probability for the bot's card times the pack size; 1 means no more than uniform. */
  readonly botPickLift: number;
  readonly meanTopProbability: number;
  readonly meanConfidence: number | null;
}

export function agreement(views: readonly DecisionView[]): AgreementReport {
  const confidences = views.flatMap((view) => (view.confidence === null ? [] : [view.confidence]));
  return {
    decisions: views.length,
    top1: mean(views.map((view) => (view.choice === view.botPickId ? 1 : 0))),
    chanceTop1: mean(views.map((view) => 1 / view.packIds.length)),
    botPickLift: mean(
      views.map((view) => (view.probabilities.get(view.botPickId) ?? 0) * view.packIds.length),
    ),
    meanTopProbability: mean(views.map((view) => Math.max(...view.probabilities.values()))),
    meanConfidence: confidences.length === 0 ? null : mean(confidences),
  };
}

export interface StabilityReport {
  /** Decisions that have both a primary answer and a repeat. */
  readonly pairs: number;
  readonly sameChoice: number;
  /** Repeats whose whole probability vector matches the first call's: a sign of a cache. */
  readonly identicalVectors: number;
  /** Mean total variation distance between the two calls' distributions: 0 same, 1 disjoint. */
  readonly meanTotalVariation: number;
  /** Mean Spearman correlation between the two calls' probabilities, over decisions where it is defined. */
  readonly meanRankCorrelation: number;
}

export function stability(answers: readonly AnswerRecord[]): StabilityReport {
  const firsts = new Map(primaryViews(answers).map((view) => [view.key, view]));
  const pairs = answers
    .filter((record) => record.repeat === 1)
    .flatMap((record) => {
      const first = firsts.get(record.key);
      return first === undefined ? [] : [{ first, second: viewOf(record) }];
    });
  const rankCorrelations = pairs
    .map(({ first, second }) => {
      const ids = first.packIds;
      return spearman(
        ids.map((id) => first.probabilities.get(id) ?? 0),
        ids.map((id) => second.probabilities.get(id) ?? 0),
      );
    })
    .filter((value) => !Number.isNaN(value));
  const distances = pairs.map(
    ({ first, second }) =>
      first.packIds.reduce(
        (sum, id) => sum + Math.abs((first.probabilities.get(id) ?? 0) - (second.probabilities.get(id) ?? 0)),
        0,
      ) / 2,
  );
  return {
    pairs: pairs.length,
    sameChoice: pairs.filter(({ first, second }) => first.choice === second.choice).length,
    identicalVectors: distances.filter((distance) => distance === 0).length,
    meanTotalVariation: mean(distances),
    meanRankCorrelation: mean(rankCorrelations),
  };
}

export interface CardLift {
  readonly cardId: string;
  readonly appearances: number;
  /** Mean over appearances of Jev's probability times the pack size. */
  readonly meanLift: number;
}

export function cardLifts(views: readonly DecisionView[]): readonly CardLift[] {
  const lifts = new Map<string, number[]>();
  for (const view of views) {
    for (const id of view.packIds) {
      const list = lifts.get(id) ?? [];
      list.push((view.probabilities.get(id) ?? 0) * view.packIds.length);
      lifts.set(id, list);
    }
  }
  return [...lifts].map(([cardId, list]) => ({ cardId, appearances: list.length, meanLift: mean(list) }));
}

/** What the balance harness measured for one card, and what the deck builder rated it. */
export interface CardBenchmark {
  readonly cardId: string;
  /** The campaign's strength estimate, or null when it was under-sampled. */
  readonly strength: number | null;
  /** The Draftmancer 0-5 rating the bots draft on. */
  readonly rating: number;
}

export interface Correlation {
  readonly rho: number;
  readonly interval: Interval | null;
}

export interface CardLevelReport {
  readonly cards: number;
  readonly minAppearances: number;
  readonly jevVsStrength: Correlation;
  readonly ratingVsStrength: Correlation;
  readonly jevVsRating: number;
  /** jev - rating, on the same cards and the same resamples. Above zero means Jev ranks strength better. */
  readonly advantage: { readonly value: number; readonly interval: Interval | null };
}

export const DEFAULT_MIN_APPEARANCES = 5;

export function cardLevel(
  views: readonly DecisionView[],
  benchmarks: readonly CardBenchmark[],
  minAppearances = DEFAULT_MIN_APPEARANCES,
  seed = 'jev-label/card-level',
): CardLevelReport {
  const lifts = new Map(cardLifts(views).map((lift) => [lift.cardId, lift]));
  const rows = benchmarks.flatMap((benchmark) => {
    const lift = lifts.get(benchmark.cardId);
    if (lift === undefined || lift.appearances < minAppearances || benchmark.strength === null) return [];
    return [{ jev: lift.meanLift, rating: benchmark.rating, strength: benchmark.strength }];
  });
  const jev = rows.map((row) => row.jev);
  const rating = rows.map((row) => row.rating);
  const strength = rows.map((row) => row.strength);
  const pick = (values: readonly number[], indexes: readonly number[]): number[] =>
    indexes.map((index) => values[index] as number);
  const jevOn = (indexes: readonly number[]): number => spearman(pick(jev, indexes), pick(strength, indexes));
  const ratingOn = (indexes: readonly number[]): number =>
    spearman(pick(rating, indexes), pick(strength, indexes));
  const all = rows.map((_row, index) => index);
  return {
    cards: rows.length,
    minAppearances,
    jevVsStrength: { rho: jevOn(all), interval: bootstrapInterval(rows.length, jevOn, `${seed}/jev`) },
    ratingVsStrength: {
      rho: ratingOn(all),
      interval: bootstrapInterval(rows.length, ratingOn, `${seed}/rating`),
    },
    jevVsRating: spearman(jev, rating),
    advantage: {
      value: jevOn(all) - ratingOn(all),
      interval: bootstrapInterval(
        rows.length,
        (indexes) => jevOn(indexes) - ratingOn(indexes),
        `${seed}/advantage`,
      ),
    },
  };
}

export interface DisagreementReport {
  /** Decisions where Jev's choice differs from the bot's and both cards have a strength estimate. */
  readonly decisions: number;
  /** Mean of (Jev's card strength - bot's card strength). Above zero means Jev picked the stronger card. */
  readonly meanStrengthDelta: number;
  readonly jevStronger: number;
  readonly interval: Interval | null;
}

export function disagreement(
  views: readonly DecisionView[],
  strengths: ReadonlyMap<string, number>,
  seed = 'jev-label/disagreement',
): DisagreementReport {
  const deltas = views.flatMap((view) => {
    if (view.choice === view.botPickId) return [];
    const jev = strengths.get(view.choice);
    const bot = strengths.get(view.botPickId);
    return jev === undefined || bot === undefined ? [] : [jev - bot];
  });
  const meanOf = (indexes: readonly number[]): number =>
    mean(indexes.map((index) => deltas[index] as number));
  return {
    decisions: deltas.length,
    meanStrengthDelta: mean(deltas),
    jevStronger: deltas.filter((delta) => delta > 0).length,
    interval: bootstrapInterval(deltas.length, meanOf, seed),
  };
}
