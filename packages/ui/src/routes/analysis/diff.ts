/**
 * Revision diff: what a design change did to every metric.
 *
 * The unit of comparison is the gate, because a gate is the only thing in the
 * run that carries its own bound and its own verdict. Comparing raw statistics
 * would mean this module deciding which direction is good for each of them,
 * which is exactly the judgment `@mtg/metrics` already encoded.
 *
 * Three cases are handled explicitly and none of them is silently a zero:
 *
 *  - **Present in both.** A signed delta in the gate's own units, and a verdict
 *    change (pass to fail is a regression however small the number moved).
 *  - **Present in one.** Color-pair gates come and go with the set: a revision
 *    that drops a pair drops `balance.pair.XY` with it. The row stays, says
 *    which run it is missing from, and reports no delta.
 *  - **Present in both but under-sampled on either side.** No delta, because
 *    subtracting a measured number from a withheld one produces a number that
 *    looks like evidence and is not.
 */
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { ChartFigure, DataTable, Stat } from './chart';
import type { TableRow } from './chart';
import { NOT_ENOUGH_EVIDENCE, integer, sampleSize } from './evidence';
import type { AnalysisRun, GateStatus, RunGate } from './model';

export type MetricPresence = 'both' | 'baseOnly' | 'revisionOnly';
export type MetricMovement = 'improved' | 'regressed' | 'unchanged' | 'unknown';

export interface DiffRow {
  readonly id: string;
  readonly label: string;
  readonly presence: MetricPresence;
  readonly base: RunGate | null;
  readonly revision: RunGate | null;
  /** In the gate's own units; `null` whenever either side has no number. */
  readonly delta: number | null;
  /** Why there is no delta. `null` when there is one. */
  readonly withheld: string | null;
  readonly movement: MetricMovement;
}

/**
 * The verdict change, where there is one on both sides.
 *
 * `underSampled` is not a verdict, so no movement is read across it in either
 * direction. A gate that failed and is now unmeasured has not improved — the
 * revision stopped looking — and one that was unmeasured and now fails has not
 * regressed, it has been measured for the first time. Reporting either as a
 * movement puts a green or red count on the page that no number underneath it
 * supports, which is the same laundering the withheld delta exists to prevent.
 *
 * `withinNoise` is not a verdict either, and it is the easier of the two to
 * launder: a gate that failed at 10,035 games and abstains at 2,700 looks like
 * an improvement and is a smaller sweep. Same rule, same reason.
 */
function movementOf(base: GateStatus | null, revision: GateStatus | null): MetricMovement {
  if (base === null || revision === null) return 'unknown';
  if (base === 'underSampled' || revision === 'underSampled') return 'unknown';
  if (base === 'withinNoise' || revision === 'withinNoise') return 'unknown';
  if (base === revision) return 'unchanged';
  return revision === 'fail' ? 'regressed' : 'improved';
}

function gateIndex(gates: readonly RunGate[]): ReadonlyMap<string, RunGate> {
  return new Map(gates.map((gate) => [gate.id, gate]));
}

/**
 * Every gate in either run, base order first, then whatever the revision added.
 *
 * Stable ordering matters more than it sounds: a diff whose rows move between
 * renders is a diff nobody trusts.
 */
export function diffRuns(base: AnalysisRun, revision: AnalysisRun): readonly DiffRow[] {
  const baseGates = gateIndex(base.health.gates);
  const revisionGates = gateIndex(revision.health.gates);
  const ids = [
    ...base.health.gates.map((gate) => gate.id),
    ...revision.health.gates.map((gate) => gate.id).filter((id) => !baseGates.has(id)),
  ];

  return ids.map((id) => {
    const left = baseGates.get(id) ?? null;
    const right = revisionGates.get(id) ?? null;
    const presence: MetricPresence =
      left !== null && right !== null ? 'both' : left === null ? 'revisionOnly' : 'baseOnly';
    const label = left?.label ?? right?.label ?? id;

    if (left === null || right === null) {
      const missingFrom = left === null ? base.label : revision.label;
      return {
        id,
        label,
        presence,
        base: left,
        revision: right,
        delta: null,
        withheld: `absent in ${missingFrom}`,
        movement: 'unknown' as const,
      };
    }
    if (left.observed === null || right.observed === null) {
      return {
        id,
        label,
        presence,
        base: left,
        revision: right,
        delta: null,
        withheld: `${NOT_ENOUGH_EVIDENCE} on ${left.observed === null ? base.label : revision.label}`,
        movement: movementOf(left.status, right.status),
      };
    }
    return {
      id,
      label,
      presence,
      base: left,
      revision: right,
      delta: right.observed - left.observed,
      withheld: null,
      movement: movementOf(left.status, right.status),
    };
  });
}

/**
 * Formats a gate's observed value in the gate's own units.
 *
 * The unit is read off the producer's own `bound` string rather than guessed
 * from the id: `@mtg/metrics` writes shares as percentages there and rounds as
 * rounds, so the bound is the one place that already knows.
 */
export function formatObserved(gate: RunGate | null): string {
  if (gate === null) return '—';
  if (gate.observed === null) return NOT_ENOUGH_EVIDENCE;
  if (gate.bound.includes('%')) return `${(gate.observed * 100).toFixed(1)}%`;
  if (Number.isInteger(gate.observed)) return integer(gate.observed);
  return gate.observed.toFixed(2);
}

export function formatDelta(row: DiffRow): string {
  if (row.delta === null) return '—';
  const percentUnits = row.base?.bound.includes('%') === true;
  const value = percentUnits ? row.delta * 100 : row.delta;
  const suffix = percentUnits ? 'pp' : '';
  if (Math.abs(value) < 5e-3) return `0.0${suffix}`;
  return `${value > 0 ? '+' : ''}${value.toFixed(percentUnits ? 1 : 2)}${suffix}`;
}

function movementDirection(movement: MetricMovement): string {
  switch (movement) {
    case 'improved':
      return 'up';
    case 'regressed':
      return 'down';
    case 'unchanged':
      return 'flat';
    case 'unknown':
      return 'none';
  }
}

const MOVEMENT_LABEL: Readonly<Record<MetricMovement, string>> = {
  improved: 'improved',
  regressed: 'regressed',
  unchanged: 'unchanged',
  unknown: 'no verdict',
};

function statusBadge(gate: RunGate | null): ReactNode {
  if (gate === null) return '—';
  const tone = gate.status === 'pass' ? 'positive' : gate.status === 'fail' ? 'negative' : 'pending';
  return createElement('span', { className: 'mtg-badge', 'data-tone': tone }, gate.status);
}

export interface DiffPanelProps {
  readonly base: AnalysisRun;
  readonly revision: AnalysisRun;
}

export function RevisionDiffPanel(props: DiffPanelProps): ReactElement {
  const rows = diffRuns(props.base, props.revision);
  const regressed = rows.filter((row) => row.movement === 'regressed');
  const improved = rows.filter((row) => row.movement === 'improved');
  const missing = rows.filter((row) => row.presence !== 'both');
  const withheld = rows.filter((row) => row.presence === 'both' && row.delta === null);

  const tableRows: readonly TableRow[] = rows.map((row) => ({
    key: row.id,
    cells: [
      createElement(
        'span',
        { title: row.id },
        row.label,
        row.withheld === null
          ? null
          : createElement('span', { className: 'mtg-chart__sample' }, ` · ${row.withheld}`),
      ),
      formatObserved(row.base),
      formatObserved(row.revision),
      createElement(
        'span',
        { className: 'mtg-delta', 'data-direction': movementDirection(row.movement) },
        formatDelta(row),
      ),
      statusBadge(row.base),
      statusBadge(row.revision),
      MOVEMENT_LABEL[row.movement],
    ],
  }));

  const sample = sampleSize(
    props.base.health.games + props.revision.health.games,
    props.base.health.distinctGames + props.revision.health.distinctGames,
    0,
    'games across both runs',
  );

  return createElement(
    'section',
    { className: 'mtg-analysis', 'aria-label': 'Revision diff' },
    createElement(
      'div',
      { className: 'mtg-stats' },
      createElement(Stat, {
        key: 'regressed',
        label: 'Gates regressed',
        value: integer(regressed.length),
        note:
          regressed.length === 0
            ? 'nothing that passed now fails'
            : regressed.map((row) => row.id).join(', '),
        ...(regressed.length === 0 ? { tone: 'positive' as const } : { tone: 'negative' as const }),
      }),
      createElement(Stat, {
        key: 'improved',
        label: 'Gates improved',
        value: integer(improved.length),
        note:
          improved.length === 0 ? 'nothing that failed now passes' : improved.map((row) => row.id).join(', '),
        ...(improved.length > 0 ? { tone: 'positive' as const } : {}),
      }),
      createElement(Stat, {
        key: 'missing',
        label: 'Metrics on one side only',
        value: integer(missing.length),
        note: 'a color pair the revision added or dropped shows up here',
        ...(missing.length > 0 ? { tone: 'pending' as const } : {}),
      }),
      createElement(Stat, {
        key: 'withheld',
        label: 'Deltas withheld',
        value: integer(withheld.length),
        note: `both runs have the gate, at least one had ${NOT_ENOUGH_EVIDENCE}`,
        ...(withheld.length > 0 ? { tone: 'pending' as const } : {}),
      }),
    ),
    createElement(ChartFigure, {
      title: `${props.base.label} → ${props.revision.label}`,
      sample,
      chart: createElement(DataTable, {
        columns: [
          'Metric',
          props.base.label,
          props.revision.label,
          'Δ',
          `${props.base.label} verdict`,
          `${props.revision.label} verdict`,
          'Movement',
        ],
        rows: tableRows,
        numericFrom: 1,
      }),
      table: createElement(DataTable, {
        columns: ['Metric id', 'Base', 'Revision', 'Δ', 'Note'],
        rows: rows.map((row) => ({
          key: `${row.id}-text`,
          cells: [
            row.id,
            formatObserved(row.base),
            formatObserved(row.revision),
            formatDelta(row),
            row.withheld ?? MOVEMENT_LABEL[row.movement],
          ],
        })),
      }),
      note: "Δ is in the gate's own units, read off its stated bound. Movement is the verdict change, not the sign of the number: which direction is good is a property of the gate, and the gate already knows.",
    }),
  );
}
