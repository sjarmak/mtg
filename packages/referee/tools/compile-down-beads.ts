/**
 * The compile-down backlog against the tracker.
 *
 * ADR-0001 §2.4 wants every referee invocation to leave behind a bead that
 * compiles the mechanic down, and acceptance 3 wants that backlog "visible and
 * shrinking". `compileDownBacklog` produced the entries and `formatBacklog`
 * printed them, but nothing ever filed one and nothing ever closed one, so
 * "shrinking" was a word rather than a measurement. This is the missing half.
 *
 * Usage:
 *   npx tsx packages/referee/tools/compile-down-beads.ts --records <path>
 *     [--beads <path>] [--parent <bead id>] [--priority <0-4>]
 *
 * `--records` is a JSON array of `RulingRecord`, which is what `referee.records()`
 * and `RefereedRun.rulings` return; write one out with `JSON.stringify` at the end
 * of a refereed run. `--beads` is a JSON array carrying `id` and `title`, which
 * `bd list --json --status open` already produces; without it the tool runs that
 * command itself.
 *
 * It prints commands and runs none of them. That is the point rather than a
 * limitation: filing and closing are writes to a tracker a person shares, and a
 * tool that performed them would be deciding on the strength of one run's
 * records that somebody else's bead is finished.
 *
 * It is also not a gate, and exits 0 whatever the diff says. Its verdict is a
 * function of a records file the caller named and of the tracker's live state,
 * neither of which is tracked in this repository, so a non-zero exit here would
 * be a CI failure that depends on the machine it ran on.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { BacklogAction, RulingRecord, TrackedBead } from '../src/index';
import { compileDownBacklog, diffCompileDownBacklog, formatBacklog } from '../src/index';

export interface ToolArgs {
  readonly recordsPath: string;
  readonly beadsPath: string | null;
  readonly parent: string | null;
  readonly priority: string;
}

export function readToolArgs(argv: readonly string[]): ToolArgs {
  let recordsPath: string | null = null;
  let beadsPath: string | null = null;
  let parent: string | null = null;
  let priority = '2';
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--records') {
      recordsPath = value ?? '';
      index += 1;
    } else if (flag === '--beads') {
      beadsPath = value ?? '';
      index += 1;
    } else if (flag === '--parent') {
      parent = value ?? '';
      index += 1;
    } else if (flag === '--priority') {
      priority = value ?? '';
      index += 1;
    } else {
      throw new Error(`unknown argument "${String(flag)}"`);
    }
  }
  if (recordsPath === null || recordsPath.length === 0) {
    throw new Error('--records is required: the JSON a refereed run wrote its rulings to');
  }
  if (beadsPath !== null && beadsPath.length === 0) throw new Error('--beads needs a path');
  if (parent !== null && parent.length === 0) throw new Error('--parent needs a bead id');
  if (!/^[0-4]$/.test(priority)) throw new Error(`--priority must be 0-4, not "${priority}"`);
  return { recordsPath, beadsPath, parent, priority };
}

/**
 * A run's rulings, validated field by field.
 *
 * Only the four fields the diff reads are required, because this file is
 * written by a caller rather than by a schema and refusing it over a missing
 * `latencyMs` would reject an input the tool could have used. Everything
 * required is checked: a record whose `enumerationComplete` arrived as the
 * string "false" would otherwise be truthy and hide the one gap this tool exists
 * to find.
 */
export function parseRulingRecords(raw: unknown): readonly RulingRecord[] {
  if (!Array.isArray(raw)) throw new Error('records: expected a JSON array of rulings');
  return raw.map((entry, index) => {
    const where = `records[${String(index)}]`;
    if (typeof entry !== 'object' || entry === null) throw new Error(`${where}: expected an object`);
    const one = entry as Record<string, unknown>;
    if (typeof one['decision'] !== 'string' || one['decision'].length === 0) {
      throw new Error(`${where}.decision: expected a decision kind`);
    }
    if (typeof one['enumerationComplete'] !== 'boolean') {
      throw new Error(`${where}.enumerationComplete: expected a boolean`);
    }
    if (typeof one['optionCount'] !== 'number' || !Number.isInteger(one['optionCount'])) {
      throw new Error(`${where}.optionCount: expected an integer`);
    }
    return one as unknown as RulingRecord;
  });
}

/** The tracker's open issues, reduced to the two fields the diff reads. */
export function parseTrackedBeads(raw: unknown): readonly TrackedBead[] {
  if (!Array.isArray(raw)) throw new Error('beads: expected a JSON array of issues');
  return raw.map((entry, index) => {
    const where = `beads[${String(index)}]`;
    if (typeof entry !== 'object' || entry === null) throw new Error(`${where}: expected an object`);
    const one = entry as Record<string, unknown>;
    const id = one['id'];
    const title = one['title'];
    if (typeof id !== 'string' || id.length === 0) throw new Error(`${where}.id: expected an issue id`);
    if (typeof title !== 'string') throw new Error(`${where}.title: expected a title`);
    return { id, title };
  });
}

/** One shell command per action, or null where the tool has nothing to propose. */
export function commandFor(
  action: BacklogAction,
  args: Pick<ToolArgs, 'parent' | 'priority'>,
): string | null {
  if (action.verdict === 'file') {
    const entry = action.entry;
    if (entry === null) return null;
    const parent = args.parent === null ? '' : ` --parent ${args.parent}`;
    return [
      `bd create ${shellQuote(entry.title)} -p ${args.priority}${parent} --body-file - <<'BODY'`,
      entry.body,
      'BODY',
    ].join('\n');
  }
  if (action.verdict === 'close') {
    const reason = `this run ruled on ${action.decision} and the kernel reported every enumeration complete`;
    return action.beads.map((bead) => `bd close ${bead.id} --reason ${shellQuote(reason)}`).join('\n');
  }
  return null;
}

const VERDICT_LINES: Readonly<Record<BacklogAction['verdict'], string>> = {
  file: 'file       capped in this run, and the tracker holds no bead for it',
  tracked: 'tracked    capped in this run, and a bead is already open for it',
  duplicate: 'duplicate  capped in this run, and more than one open bead claims it; nothing proposed',
  close: 'close      ruled on in this run with every enumeration complete, so the cap is gone',
  unobserved: 'unobserved this run never reached a decision of this kind, so it says nothing either way',
};

export function formatDiff(
  actions: readonly BacklogAction[],
  args: Pick<ToolArgs, 'parent' | 'priority'>,
): string {
  const counts = new Map<BacklogAction['verdict'], number>();
  for (const action of actions) counts.set(action.verdict, (counts.get(action.verdict) ?? 0) + 1);
  const legend = (Object.keys(VERDICT_LINES) as BacklogAction['verdict'][])
    .filter((verdict) => (counts.get(verdict) ?? 0) > 0)
    .map((verdict) => `  ${VERDICT_LINES[verdict]}`);

  const rows = actions.map((action) => {
    const ids = action.beads.map((bead) => bead.id).join(', ');
    return `  ${action.verdict.padEnd(10)} ${action.decision}${ids === '' ? '' : ` (${ids})`}`;
  });

  const commands = actions
    .map((action) => commandFor(action, args))
    .filter((command): command is string => command !== null);

  const head =
    actions.length === 0
      ? [
          'Compile-down beads: nothing to file and nothing to close. This run hit no capped',
          'enumeration, and the tracker holds no open compile-down bead to measure against it.',
        ]
      : [`Compile-down beads: ${String(actions.length)} decision kind(s).`, ...legend, '', ...rows];

  if (commands.length === 0) {
    return [...head, '', 'No command to run: nothing here is a file or a close.'].join('\n');
  }
  return [...head, '', `${String(commands.length)} command(s) to approve:`, '', ...commands].join('\n');
}

/** Single-quoted for a POSIX shell, since a title is arbitrary text. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function readJson(path: string, what: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error: unknown) {
    throw new Error(
      `${what}: cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error: unknown) {
    throw new Error(
      `${what}: ${path} is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * The tracker's open issues, from the tracker, when the caller named no file.
 *
 * Argument array rather than a command string, because a shell here would take
 * its arguments from the same place the printed `bd` commands come from and
 * this tool's whole safety property is that nothing it composes is executed.
 */
function readOpenBeads(): readonly TrackedBead[] {
  let text: string;
  try {
    text = execFileSync('bd', ['list', '--json', '--status', 'open'], { encoding: 'utf8' });
  } catch (error: unknown) {
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(`beads: \`bd list --json --status open\` failed (${why}); pass --beads <path> instead`);
  }
  try {
    return parseTrackedBeads(JSON.parse(text) as unknown);
  } catch (error: unknown) {
    throw new Error(
      `beads: bd did not return readable JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function main(argv: readonly string[]): number {
  const args = readToolArgs(argv);
  const records = parseRulingRecords(readJson(args.recordsPath, 'records'));
  const beads =
    args.beadsPath === null ? readOpenBeads() : parseTrackedBeads(readJson(args.beadsPath, 'beads'));

  console.log(`records       ${String(records.length)} ruling(s) from ${args.recordsPath}`);
  console.log(
    `open beads    ${String(beads.length)} from ${args.beadsPath ?? 'bd list --json --status open'}`,
  );
  console.log(formatBacklog(compileDownBacklog(records)));
  console.log('');
  console.log(formatDiff(diffCompileDownBacklog(records, beads), args));
  return 0;
}

const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith('compile-down-beads.ts');

if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
