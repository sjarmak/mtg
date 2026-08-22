/**
 * The compile-down backlog.
 *
 * ADR-0001 §2.4 says every referee invocation files a bead to compile that
 * mechanic down into the DSL, so the referee stays a ramp rather than becoming
 * a tier. That instruction assumes a mechanic the DSL cannot express yet, and
 * in this checkout there is none: the DSL's effect vocabulary is closed, the
 * kernel's `assertNever` refuses anything outside it, and every decision the
 * kernel poses arrives with a legal-option list a deterministic agent can
 * answer. A referee here is an alternative policy on an enumerated choice, not
 * a gap-filler.
 *
 * So the backlog is built from the one gap the kernel does report: a decision
 * whose enumeration was capped (`complete: false`) is a decision whose option
 * list is a subset of the legal space, and choosing inside it is choosing
 * inside a truncation. That is a real thing to compile down — the fix is a
 * constructive enumerator for that decision kind, not a bigger cap.
 *
 * An empty backlog is printed as a sentence rather than as nothing, because
 * "the referee ruled and there is nothing to compile down" is a claim someone
 * should be able to read and disagree with.
 */
import type { Decision } from '@mtg/kernel';
import type { RulingRecord } from './referee';

export interface CompileDownEntry {
  readonly decision: Decision['kind'];
  /** Rulings on a capped enumeration of this kind. */
  readonly occurrences: number;
  /** The largest option list seen, which is the cap that bit. */
  readonly optionCount: number;
  readonly title: string;
  readonly body: string;
}

/**
 * One entry per decision kind the kernel could not fully enumerate, in the
 * order those kinds were first seen.
 */
export function compileDownBacklog(records: readonly RulingRecord[]): readonly CompileDownEntry[] {
  const byKind = new Map<Decision['kind'], { occurrences: number; optionCount: number }>();
  for (const record of records) {
    if (record.enumerationComplete) continue;
    const seen = byKind.get(record.decision);
    byKind.set(record.decision, {
      occurrences: (seen?.occurrences ?? 0) + 1,
      optionCount: Math.max(seen?.optionCount ?? 0, record.optionCount),
    });
  }
  return [...byKind.entries()].map(([decision, counts]) => ({
    decision,
    occurrences: counts.occurrences,
    optionCount: counts.optionCount,
    title: `Compile down: enumerate ${decision} without a cap`,
    body: bodyFor(decision, counts.occurrences, counts.optionCount),
  }));
}

/** The backlog as a person reads it, including when it is empty. */
export function formatBacklog(entries: readonly CompileDownEntry[]): string {
  if (entries.length === 0) {
    return (
      'Compile-down backlog: nothing to compile down. Every decision the referee ruled on ' +
      'came with a complete enumeration from the kernel, so a deterministic handler already ' +
      'covers it and no mechanic is waiting on the DSL.'
    );
  }
  const lines = entries.map(
    (entry) =>
      `  ${entry.decision}: ${String(entry.occurrences)} ruling(s) on a capped list ` +
      `(largest seen ${String(entry.optionCount)} options) — ${entry.title}`,
  );
  return [`Compile-down backlog: ${String(entries.length)} entry(s).`, ...lines].join('\n');
}

function bodyFor(decision: Decision['kind'], occurrences: number, optionCount: number): string {
  return [
    `The referee ruled ${String(occurrences)} time(s) on a "${decision}" decision whose enumeration`,
    `was capped: the kernel offered ${String(optionCount)} option(s) and reported the list as`,
    'incomplete, so both the referee and every deterministic agent were choosing inside a subset',
    'of the legal space rather than over it.',
    '',
    'Compile it down by giving this decision kind a constructive chooser that works from the',
    'position instead of from an enumerated list, the way `validateAction` already re-derives',
    'legality rather than trusting the enumeration. Raising the cap is not the fix; it moves the',
    'position at which the truncation happens.',
    '',
    'Filed from @mtg/referee under mtg-bc2.23 (ADR-0001 §2.4).',
  ].join('\n');
}
