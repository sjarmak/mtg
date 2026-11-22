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
 *
 * Filing and closing live one layer out, in `tools/compile-down-beads.ts`. The
 * entries and the diff below are tracker-neutral on purpose: this package is
 * imported by tests that CI runs, and a library that shells out to a tracker is
 * a library CI cannot run and a write nobody approved. What is here is the
 * judgment — which kinds are capped, which open beads answer to them, and which
 * of those this run has no evidence about. What the tool adds is the two `bd`
 * commands and a person to read them.
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
    title: compileDownTitle(decision),
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

/**
 * A bead the tracker is holding open, reduced to what a diff can read.
 *
 * Deliberately not the tracker's whole record: this package must be runnable
 * from a JSON file a person pasted, and every field beyond these two is a
 * reason for the tool to refuse an input it could have read.
 */
export interface TrackedBead {
  readonly id: string;
  readonly title: string;
}

/**
 * What the diff says about one decision kind.
 *
 * `close` is the only verdict that asserts something about the *world* rather
 * than about the run, and it is the one worth being careful with — see
 * `diffCompileDownBacklog`.
 */
export type BacklogVerdict = 'file' | 'tracked' | 'duplicate' | 'close' | 'unobserved';

export interface BacklogAction {
  readonly verdict: BacklogVerdict;
  readonly decision: Decision['kind'];
  /** Every open bead carrying this kind's title, in the order the tracker gave them. */
  readonly beads: readonly TrackedBead[];
  /** The entry behind a `file`, so the caller can print a body without rebuilding it. */
  readonly entry: CompileDownEntry | null;
}

/** The title a compile-down bead carries, which is also how one is recognized. */
export function compileDownTitle(decision: Decision['kind']): string {
  return `Compile down: enumerate ${decision} without a cap`;
}

/**
 * The decision kind a bead title names, or null when the title is not one of
 * ours.
 *
 * A bead this tool did not file must never be proposed for closing, so the
 * match is the exact string `compileDownTitle` produces rather than a substring
 * or a prefix. A person who retitles one has taken it out of the tool's hands,
 * which is the right outcome: the tool then offers to file a fresh one and says
 * nothing about theirs.
 */
export function compileDownDecision(title: string): Decision['kind'] | null {
  const prefix = 'Compile down: enumerate ';
  const suffix = ' without a cap';
  if (!title.startsWith(prefix) || !title.endsWith(suffix)) return null;
  const kind = title.slice(prefix.length, title.length - suffix.length);
  return kind.length === 0 || kind.includes(' ') ? null : (kind as Decision['kind']);
}

/**
 * The backlog against the tracker: what to file, what to close, and what this
 * run cannot speak to.
 *
 * Filing is the easy half. Closing is not, because "this run's backlog has no
 * entry for that kind" has two causes that look identical from the backlog
 * alone: the cap is gone, or the run never reached a decision of that kind. The
 * first is a bead to close and the second is a bead nobody has tested, and
 * closing the second on the first's evidence retires a real gap on a run that
 * never looked at it.
 *
 * So a close needs the records, not the entries: the run must have ruled on
 * that kind at least once, and every one of those rulings must have reported a
 * complete enumeration. A kind the records never mention comes back
 * `unobserved` and is proposed for nothing.
 */
export function diffCompileDownBacklog(
  records: readonly RulingRecord[],
  beads: readonly TrackedBead[],
): readonly BacklogAction[] {
  const entries = new Map(compileDownBacklog(records).map((entry) => [entry.decision, entry]));
  const open = new Map<Decision['kind'], TrackedBead[]>();
  for (const bead of beads) {
    const decision = compileDownDecision(bead.title);
    if (decision === null) continue;
    const seen = open.get(decision);
    if (seen === undefined) open.set(decision, [bead]);
    else seen.push(bead);
  }

  const actions: BacklogAction[] = [];
  for (const [decision, entry] of entries) {
    const held = open.get(decision) ?? [];
    const verdict: BacklogVerdict = held.length === 0 ? 'file' : held.length === 1 ? 'tracked' : 'duplicate';
    actions.push({ verdict, decision, beads: held, entry });
  }
  for (const [decision, held] of open) {
    if (entries.has(decision)) continue;
    const ruled = records.filter((one) => one.decision === decision);
    const verdict: BacklogVerdict = ruled.length === 0 ? 'unobserved' : 'close';
    actions.push({ verdict, decision, beads: held, entry: null });
  }
  return actions;
}
