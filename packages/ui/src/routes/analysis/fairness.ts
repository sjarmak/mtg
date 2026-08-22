/**
 * The answer, and only then the evidence.
 *
 * Every other section of this surface draws a statistic. This one draws the
 * sentence somebody asked for: is the set fair. It computes nothing — the
 * verdict, the four readings and every finding are `@mtg/metrics`' work,
 * carried in the document — so what is decided here is only what a person sees
 * first and what they can act on.
 *
 * Three rules the layout is built around, each of them something the flat gate
 * table below could not do:
 *
 *  1. **The four questions are always all four, and always in the same order**,
 *     whether or not they had anything to say. A question that turned out fine
 *     is part of the answer; leaving it out would hide the shape of the reply
 *     behind the subset that happened to go wrong.
 *  2. **A miss is a number in the units the gate measures.** Every finding
 *     reads "measured X against Y, missing it by Z" rather than a bar, a color
 *     or an adjective, because Z is what tells a designer how much to move.
 *  3. **A miss smaller than the dice is said to be.** `withinNoise` marks a
 *     failure the seed alone could produce, and the row says so beside the
 *     number instead of quietly downgrading a gate the CI job still fails.
 *
 * Nothing here paints a verdict with color alone: every tone rides beside the
 * word it means, which is `styles/tokens.ts`' standing rule for the three
 * state tokens.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderCopy } from '../../copy';
import { integer } from './evidence';
import type { FairnessVerdict, RunFairness, RunFairnessReading, RunFinding, RunUnjudged } from './model';

/** Exactly `@mtg/metrics`' `NOT_ASKED`, repeated for the reason the protocol version is. */
export const NOT_ASKED = 'this run measured no gate for it';

export const VERDICT_LABELS: Readonly<Record<FairnessVerdict, string>> = {
  fair: 'fair',
  unfair: 'not fair',
  unjudged: 'not judged',
};

/**
 * `unjudged` is `pending`, never `positive`.
 *
 * The whole point of the third verdict is that it is not a pass, and a green
 * tile over "not judged" would be the dashboard contradicting the word printed
 * inside it — the same mistake `gateTone` was fixed for one file over.
 */
export function verdictTone(verdict: FairnessVerdict): 'positive' | 'negative' | 'pending' {
  switch (verdict) {
    case 'fair':
      return 'positive';
    case 'unfair':
      return 'negative';
    case 'unjudged':
      return 'pending';
  }
}

/** Enough digits to see a small miss, few enough to read. */
function amount(value: number): string {
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(3);
}

/**
 * The finding as one sentence, assembled from the numbers on the finding.
 *
 * Mirrors `@mtg/metrics`' `findingLine` rather than importing it, for the
 * reason every other type in this route is restated: `@mtg/metrics` reaches
 * `@mtg/sim`, and `@mtg/sim`'s barrel reaches `node:worker_threads`, which
 * cannot enter a browser bundle. `test/analysis/fairness.test.ts` renders a
 * produced document, so the two sentences are checked against one document
 * rather than trusted to stay alike.
 */
export function findingText(finding: RunFinding): string {
  const noise =
    finding.withinNoise && finding.noise !== null
      ? ` This is inside the ${amount(finding.noise)} the statistic moves on the seed alone, so another seed could put it either side.`
      : '';
  return (
    `Measured ${amount(finding.measured)} against ${amount(finding.required)}, ` +
    `missing it by ${amount(finding.distance)}.${noise}`
  );
}

function findingRow(finding: RunFinding): ReactElement {
  return createElement(
    'li',
    { key: finding.gate, className: 'mtg-finding', 'data-tone': 'negative' },
    createElement(
      'span',
      { className: 'mtg-finding__head' },
      createElement('span', { className: 'mtg-badge', 'data-tone': 'negative' }, 'missed'),
      createElement('span', { className: 'mtg-finding__name' }, finding.label),
      finding.withinNoise
        ? createElement('span', { className: 'mtg-badge', 'data-tone': 'pending' }, 'inside the noise')
        : null,
    ),
    createElement('span', { className: 'mtg-finding__body' }, findingText(finding)),
    createElement('span', { className: 'mtg-finding__note' }, finding.detail),
  );
}

/**
 * Three ways to decline, three badges: they are three different instructions.
 * "Buy more games", "this subject has nothing to measure", and "at this volume
 * the miss and the dice are the same size" send a reader somewhere different,
 * and one shared badge would send them nowhere.
 */
function unjudgedBadge(status: RunUnjudged['status']): string {
  switch (status) {
    case 'underSampled':
      return 'no evidence';
    case 'notApplicable':
      return 'nothing to measure';
    case 'withinNoise':
      return 'inside the noise';
  }
}

function unjudgedRow(entry: RunUnjudged): ReactElement {
  return createElement(
    'li',
    { key: entry.gate, className: 'mtg-finding', 'data-tone': 'pending' },
    createElement(
      'span',
      { className: 'mtg-finding__head' },
      createElement('span', { className: 'mtg-badge', 'data-tone': 'pending' }, unjudgedBadge(entry.status)),
      createElement('span', { className: 'mtg-finding__name' }, entry.label),
    ),
    createElement('span', { className: 'mtg-finding__body' }, entry.reason),
  );
}

/** The census, or the sentence that says the question was never put. */
function census(reading: RunFairnessReading): string {
  if (reading.gates.length === 0) return NOT_ASKED;
  return `${integer(reading.passed)} of ${integer(reading.gates.length)} gates passed`;
}

function readingCard(reading: RunFairnessReading): ReactElement {
  const rows: readonly ReactNode[] = [
    ...reading.findings.map(findingRow),
    ...reading.unjudged.map(unjudgedRow),
  ];
  return createElement(
    'section',
    { key: reading.question, className: 'mtg-reading', 'aria-label': reading.asks },
    createElement(
      'div',
      { className: 'mtg-reading__head' },
      createElement('h3', { className: 'mtg-reading__ask' }, reading.asks),
      createElement(
        'span',
        { className: 'mtg-badge', 'data-tone': verdictTone(reading.verdict) },
        VERDICT_LABELS[reading.verdict],
      ),
      createElement('span', { className: 'mtg-reading__census' }, census(reading)),
    ),
    rows.length === 0 ? null : createElement('ul', { className: 'mtg-finding-list' }, ...rows),
  );
}

export interface FairnessPanelProps {
  readonly fairness: RunFairness;
  /** The run's own label, so the verdict names what it is a verdict about. */
  readonly about: string;
  readonly games: number;
  readonly distinctGames: number;
}

/**
 * The verdict, its four readings, and every miss with its number.
 *
 * The headline sentence names the run and the evidence behind it in the same
 * breath, because "fair" over four hundred games and "fair" over ten thousand
 * are different claims and the word alone does not separate them.
 */
export function FairnessPanel(props: FairnessPanelProps): ReactElement {
  const { fairness } = props;
  return createElement(
    'div',
    // The section label the subnav names it by, the way every other panel on
    // this surface carries its own.
    { className: 'mtg-fairness', 'aria-label': 'Is it fair' },
    createElement(
      'section',
      { className: 'mtg-verdict', 'data-tone': verdictTone(fairness.verdict), 'aria-label': 'Verdict' },
      createElement('span', { className: 'mtg-verdict__ask' }, 'Is the set fair?'),
      createElement('span', { className: 'mtg-verdict__answer' }, VERDICT_LABELS[fairness.verdict]),
      createElement(
        'span',
        { className: 'mtg-verdict__note' },
        `${props.about} — ${integer(props.games)} games, ${integer(props.distinctGames)} distinct trajectories.`,
      ),
      fairness.verdict === 'unjudged'
        ? createElement(
            'span',
            { className: 'mtg-verdict__note' },
            renderCopy(
              'Not judged is not a pass. Something below could not be measured on this run; a longer sweep (`npm run analyze -- --games 223`) is what buys the evidence.',
            ),
          )
        : null,
    ),
    createElement('div', { className: 'mtg-readings' }, ...fairness.readings.map(readingCard)),
    fairness.unattributed.length === 0
      ? null
      : createElement(
          'section',
          { className: 'mtg-panel', 'aria-label': 'Gates no question reads' },
          createElement(
            'div',
            { className: 'mtg-panel__head' },
            createElement('span', { className: 'mtg-panel__title' }, 'Gates no question reads'),
          ),
          createElement(
            'div',
            { className: 'mtg-panel__body' },
            `This run carries gates none of the four questions claims, so it cannot be called fair: ${fairness.unattributed.join(', ')}.`,
          ),
        ),
  );
}
