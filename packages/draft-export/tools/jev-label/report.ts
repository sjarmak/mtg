/**
 * The scored study as plain text, one section per question the bead asks.
 *
 * Nothing here decides anything: every line is a number from `score.ts` with the
 * unit that makes it readable, and a number that could not be computed prints
 * `n/a` rather than `NaN` so an empty sample cannot be mistaken for a result.
 */
import type {
  AgreementReport,
  CardLevelReport,
  Correlation,
  DisagreementReport,
  StabilityReport,
} from './score';
import type { Interval } from './stats';

export interface StudyReport {
  readonly agreement: AgreementReport;
  readonly stability: StabilityReport;
  readonly cardLevel: CardLevelReport;
  readonly disagreement: DisagreementReport;
}

function fixed(value: number, places: number): string {
  return Number.isFinite(value) ? value.toFixed(places) : 'n/a';
}

function percent(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'n/a';
}

function interval(range: Interval | null): string {
  return range === null ? 'interval unstable' : `95% [${fixed(range.low, 2)}, ${fixed(range.high, 2)}]`;
}

function correlation(value: Correlation): string {
  return `rho ${fixed(value.rho, 2)} (${interval(value.interval)})`;
}

export function formatReport(report: StudyReport): string {
  const { agreement, stability, cardLevel, disagreement } = report;
  const lines = [
    '(c) repeat stability',
    `  decisions asked twice: ${String(stability.pairs)}`,
    `  same choice both times: ${String(stability.sameChoice)} of ${String(stability.pairs)}`,
    `  identical probability vectors: ${String(stability.identicalVectors)} of ${String(stability.pairs)}`,
    `  mean total variation between the two calls: ${fixed(stability.meanTotalVariation, 3)} (0 identical, 1 disjoint)`,
    `  mean rank correlation between the two calls: ${fixed(stability.meanRankCorrelation, 2)}`,
    '',
    '(a) does the per-option probability predict strength',
    `  cards with at least ${String(cardLevel.minAppearances)} appearances and a strength estimate: ${String(cardLevel.cards)}`,
    `  Jev lift vs measured strength: ${correlation(cardLevel.jevVsStrength)}`,
    `  deck-builder rating vs measured strength: ${correlation(cardLevel.ratingVsStrength)}`,
    `  Jev lift vs deck-builder rating: rho ${fixed(cardLevel.jevVsRating, 2)}`,
    `  Jev minus rating, same cards, same resamples: ${fixed(cardLevel.advantage.value, 2)} (${interval(cardLevel.advantage.interval)})`,
    `  where Jev and the bot disagree (${String(disagreement.decisions)} decisions with both strengths known):`,
    `    mean strength of Jev's card minus the bot's card: ${fixed(disagreement.meanStrengthDelta, 4)} (${interval(disagreement.interval)})`,
    `    Jev's card was the stronger one in ${String(disagreement.jevStronger)} of them`,
    '',
    'baseline agreement with the bot (a reference point, not an error rate)',
    `  decisions labeled once or more: ${String(agreement.decisions)}`,
    `  Jev's top choice is the bot's pick: ${percent(agreement.top1)} (uniform choice would agree ${percent(agreement.chanceTop1)})`,
    `  Jev's probability on the bot's pick, times the pack size: ${fixed(agreement.botPickLift, 2)} (1 is no more than uniform)`,
    `  mean probability on Jev's top choice: ${fixed(agreement.meanTopProbability, 3)}`,
    `  mean reported confidence: ${agreement.meanConfidence === null ? 'n/a' : fixed(agreement.meanConfidence, 3)}`,
    '',
    '(b) agreement with human picks: not measured; the checkout holds no human pick data for a printed cube.',
  ];
  return `${lines.join('\n')}\n`;
}
