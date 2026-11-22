/**
 * The load attribution a red verdict carries, and how a reader sees it.
 *
 * The run prints, for every test that ran out of time, what the machine was
 * doing and whether that was load (`test-load/attribution.ts`). A stored verdict
 * used to keep only the list of red files, so the next lane to read it got the
 * red without the attribution the run had already made. Recorded 2026-09-18 on
 * tree 9219696a: 18 red files under a peak 1-minute load of 41.1 on 16 cores,
 * 17 of them clocks, stored as the tree's answer with nothing in the record
 * saying so (`mtg-tgsol`).
 *
 * This is data and wording only. It changes no recording decision: `verdict.ts`
 * still refuses a red whose every file is a clock, and a red that failed an
 * assertion is still recorded whatever the load was. What it adds is that the
 * reader of the record can tell the two kinds of red file apart.
 */
import { z } from 'zod';
import type { Contention, TimeoutFinding } from '../test-load/attribution';
import { contentionOf } from '../test-load/attribution';
import type { MachineSummary } from '../test-load/timeout-only';

/** Worst first, so the index is the severity. */
const CONTENTIONS = ['saturated', 'contended', 'crowded', 'quiet'] as const satisfies readonly Contention[];

const RedFileLoadSchema = z.object({
  file: z.string().min(1),
  /** Whether every failure in the file was a clock. `classifyTimeoutOnly`'s answer. */
  clockOnly: z.boolean(),
  /**
   * How many test timeouts the reporter attributed to the file. A hook that ran
   * out of time carries no window, so a clock-only file can have none.
   */
  timeouts: z.number().int().nonnegative(),
  /** The worst contention over those timeouts' windows, or `null` when there is none to speak of. */
  contention: z.enum(CONTENTIONS).nullable(),
});

export const LoadAttributionSchema = z.object({
  cores: z.number().int().positive(),
  peakLoad1: z.number().nonnegative(),
  /** The most test files this run had in flight at once. */
  peakRunningFiles: z.number().int().nonnegative(),
  /** One entry per red file, in the order the record's `redFiles` lists them. */
  files: z.array(RedFileLoadSchema),
});

type RedFileLoad = z.infer<typeof RedFileLoadSchema>;
export type LoadAttribution = z.infer<typeof LoadAttributionSchema>;

function worstContention(found: readonly Contention[]): Contention | null {
  let worst: Contention | null = null;
  for (const contention of found) {
    if (worst === null || CONTENTIONS.indexOf(contention) < CONTENTIONS.indexOf(worst)) worst = contention;
  }
  return worst;
}

/**
 * What the run attributed each red file to, or `null` when there is nothing to
 * attach: no red file, or no load sample fell inside the run.
 */
export function attributeLoad(
  timeouts: readonly TimeoutFinding[],
  machine: MachineSummary | null,
  redFiles: readonly string[],
  clockOnlyFiles: readonly string[],
): LoadAttribution | null {
  if (machine === null || redFiles.length === 0) return null;
  return {
    cores: machine.cores,
    peakLoad1: machine.peakLoad1,
    peakRunningFiles: machine.peakRunningFiles,
    files: redFiles.map((file) => {
      const own = timeouts.filter((finding) => finding.file === file);
      return {
        file,
        clockOnly: clockOnlyFiles.includes(file),
        timeouts: own.length,
        contention: worstContention(
          own.flatMap((finding) =>
            finding.load === null ? [] : [contentionOf(machine.cores, finding.load)],
          ),
        ),
      };
    }),
  };
}

function describeFileLoad(entry: RedFileLoad | undefined): string {
  if (entry === undefined) return '';
  const parts: string[] = [];
  if (entry.clockOnly) parts.push('clock only');
  if (entry.timeouts > 0) {
    const window = entry.contention === null ? '' : `, worst window ${entry.contention}`;
    parts.push(`${entry.timeouts} timeout(s)${window}`);
  }
  return parts.length === 0 ? '' : `[${parts.join('; ')}]`;
}

/** The two lines a reader of a stored verdict needs: the box, and how much of the red was its clock. */
function describeBox(load: LoadAttribution): string {
  const clocks = load.files.filter((entry) => entry.clockOnly).length;
  const saturated = load.files.filter((entry) => entry.clockOnly && entry.contention === 'saturated').length;
  const box =
    `  box: ${load.cores} cores, peak 1-minute load ${load.peakLoad1.toFixed(1)} ` +
    `(${(load.peakLoad1 / load.cores).toFixed(1)}x per core), up to ${load.peakRunningFiles} of the run's own test files in flight`;
  if (clocks === 0) return box;
  const where = saturated === 0 ? '' : `, ${saturated} with a timeout in a saturated window`;
  return (
    `${box}\n  ${clocks} of ${load.files.length} red file(s) failed only on a clock${where}. Load can cause that, so ` +
    'measure again with `npm run gate -- --refresh` before reading those as red on this tree.'
  );
}

/**
 * The lines that follow a record's verdict: the box it was measured on, then
 * the red files, each tagged with what the run attributed it to. A record with
 * no attribution (green, or written before this existed) is the bare list.
 */
export function describeReds(redFiles: readonly string[], load: LoadAttribution | undefined): string {
  if (redFiles.length === 0) return '';
  const byFile = new Map((load?.files ?? []).map((entry) => [entry.file, entry] as const));
  const listed = redFiles.map((file) => {
    const note = describeFileLoad(byFile.get(file));
    return note === '' ? file : `${file}  ${note}`;
  });
  const box = load === undefined ? '' : `\n${describeBox(load)}`;
  return `${box}\n  red: ${listed.join('\n       ')}`;
}
