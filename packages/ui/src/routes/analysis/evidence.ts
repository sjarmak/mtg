/**
 * The sample-size discipline, as a type the chart layer cannot route around.
 *
 * `@mtg/metrics` already refuses to compute a statistic below its floor
 * (`Sampled<T>.value` is `null` exactly when `underSampled`), and the reason is
 * specific to this lab rather than general statistical hygiene: seeded bots
 * replaying one line a thousand times produce a thousand rows and one piece of
 * evidence (metrics report §10.7). A dashboard that draws those thousand rows
 * as a confident bar is worse than no dashboard, because it launders the
 * illusion through a picture.
 *
 * So every plotted number in this route passes through `evidenceFor`, which
 * re-applies the floor against **distinct** trajectories rather than trusting
 * the document. Two producers can disagree about a floor; a chart that only
 * reads `value !== null` inherits whichever one was looser. When the floor is
 * not cleared the mark is not drawn at all — `NOT_ENOUGH_EVIDENCE` is rendered
 * in its place, with the counts that would have to change for it to appear.
 */
import { createElement } from 'react';
import type { ReactElement } from 'react';

/** The exact copy for a withheld statistic. Query by it; never hardcode it. */
export const NOT_ENOUGH_EVIDENCE = 'not enough evidence';

/** How much evidence stands behind one statistic. */
export interface SampleSize {
  /** Observations counted, duplicates included. */
  readonly samples: number;
  /** Distinct game trajectories among them. The number the floor is checked against. */
  readonly distinctSamples: number;
  /** The floor `@mtg/metrics` set for this statistic. */
  readonly floor: number;
  /** What is being counted. `games` unless the panel counts something else. */
  readonly unit?: string;
}

export type Evidence<T> =
  | { readonly plotted: true; readonly value: T; readonly sample: SampleSize }
  | { readonly plotted: false; readonly sample: SampleSize; readonly reason: string };

export function sampleSize(
  samples: number,
  distinctSamples: number,
  floor: number,
  unit = 'games',
): SampleSize {
  return { samples, distinctSamples, floor, unit };
}

/** A census rather than a sample: every member counted, nothing estimated. */
export function census(size: number, unit: string): SampleSize {
  return { samples: size, distinctSamples: size, floor: 1, unit };
}

/**
 * Wraps a possibly-null statistic, re-checking the floor here.
 *
 * A value that arrived non-null from a producer whose floor was lower than the
 * floor recorded alongside it is still withheld: the recorded floor wins.
 */
export function evidenceFor<T>(value: T | null, sample: SampleSize): Evidence<T> {
  if (sample.distinctSamples < sample.floor) {
    return {
      plotted: false,
      sample,
      reason: `${integer(sample.distinctSamples)} distinct games, floor ${integer(sample.floor)}`,
    };
  }
  if (value === null) {
    return { plotted: false, sample, reason: 'the run reported no value for this statistic' };
  }
  return { plotted: true, value, sample };
}

/** Thousands-separated integer; used for every count on this route. */
export function integer(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

/** One decimal place of percent, from a 0-1 share. */
export function percent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/**
 * The line every chart carries. Non-negotiable: a chart without its sample size
 * is a vibe, and the distinct count is the honest one.
 */
export function sampleNote(sample: SampleSize): string {
  const unit = sample.unit ?? 'games';
  const head = `${integer(sample.samples)} ${unit}`;
  const floor = `floor ${integer(sample.floor)}`;
  if (sample.samples === sample.distinctSamples) return `${head} · ${floor}`;
  return `${head} · ${integer(sample.distinctSamples)} distinct · ${floor}`;
}

export interface EvidenceProps {
  readonly sample: SampleSize;
}

/** The sample-size line, rendered under a chart title. */
export function SampleNote(props: EvidenceProps): ReactElement {
  return createElement(
    'span',
    { className: 'mtg-chart__sample', 'data-distinct': String(props.sample.distinctSamples) },
    sampleNote(props.sample),
  );
}

export interface NoEvidenceProps {
  /** What would have been plotted, named so the empty state is not generic. */
  readonly statistic: string;
  readonly reason: string;
  readonly sample?: SampleSize;
}

/**
 * The empty state that replaces a mark, never a zero and never a faded bar.
 *
 * A grayed-out bar still reads as a measurement; a sentence does not.
 */
export function NoEvidence(props: NoEvidenceProps): ReactElement {
  return createElement(
    'p',
    { className: 'mtg-evidence', role: 'note', 'data-statistic': props.statistic },
    createElement('span', { className: 'mtg-evidence__title' }, NOT_ENOUGH_EVIDENCE),
    createElement('span', { className: 'mtg-evidence__body' }, `${props.statistic} · ${props.reason}`),
    props.sample === undefined
      ? null
      : createElement('span', { className: 'mtg-evidence__note' }, sampleNote(props.sample)),
  );
}

/**
 * The duplicate-trajectory warning.
 *
 * Reported on every run rather than only when it is bad, because the number a
 * reader needs is "how much of this run was new information", and a warning
 * that only appears when things are wrong teaches nobody what normal looks like.
 */
export function duplicateTone(duplicateShare: number): 'positive' | 'pending' | 'negative' {
  if (duplicateShare > 0.25) return 'negative';
  if (duplicateShare > 0.1) return 'pending';
  return 'positive';
}
