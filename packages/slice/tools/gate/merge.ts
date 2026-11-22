/**
 * The simulation gate: the projects a lane no longer runs, run once before the merge.
 *
 * ```
 * npm run gate:merge
 * npm run gate:merge -- --beside-lanes   # measure anyway beside a live worker lane
 * ```
 *
 * `suites.ts` argues the split. This file is the half that keeps it honest —
 * balance and calibration left the per-lane path on the condition that they run
 * over the merged content, and a condition nobody can invoke with one command is
 * not a condition.
 *
 * It memoizes nothing and claims nothing. The memo in `cli.ts` exists because
 * several lanes measure the same base sha within minutes of each other; this
 * runs once, on the content about to land, and a second run of it is a request
 * to measure again.
 *
 * This is always a lead's landing run, never something a lane runs on itself
 * (`CLAUDE.md`'s "Do not" list), so the same `live-lanes.ts` check `cli.ts`
 * runs applies here too: refuses and exits **3** while an mtg-worker lane is
 * live on this host, naming it, unless `--beside-lanes` was passed. A worker
 * gate would be exempt the same way `cli.ts`'s is, but this file is never run
 * from inside one.
 */
import { spawnSync } from 'node:child_process';
import { git } from './git';
import { LIVE_LANE_REFUSAL_EXIT_CODE, checkLiveLanes, readLiveProcessTable } from './live-lanes';
import { MERGE_ONLY_PROJECTS, mergeTestCommand } from './suites';
import {
  barForChangedFiles,
  changedTestListCommand,
  directReaderTestFiles,
  directTestListCommand,
  gatePlan,
  parseListedTestFiles,
  relatedTestCommand,
} from './scope';

function valueOf(argv: readonly string[], flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}

function listedFiles(command: readonly string[]): string[] {
  const [bin, ...args] = command;
  if (bin === undefined) throw new Error('empty selection command');
  const result = spawnSync(bin, args, { encoding: 'utf8', env: process.env, maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    throw new Error(`${command.join(' ')} failed`);
  }
  return parseListedTestFiles(result.stdout);
}

function run(command: readonly string[]): number {
  const [bin, ...args] = command;
  if (bin === undefined) throw new Error('empty command');
  return spawnSync(bin, args, { stdio: 'inherit', env: process.env }).status ?? 1;
}

export function main(argv: readonly string[] = []): number {
  const besideLanes = argv.includes('--beside-lanes');
  const laneCheck = checkLiveLanes(process.env, readLiveProcessTable(), besideLanes);
  if (laneCheck.message !== '') process.stdout.write(laneCheck.message);
  if (!laneCheck.ok) return LIVE_LANE_REFUSAL_EXIT_CODE;

  const baseRef = valueOf(argv, '--base') ?? 'origin/main';
  const baseSha = git(['merge-base', baseRef, 'HEAD']);
  const changedOutput = git(['diff', '--name-only', '--diff-filter=ACDMR', `${baseSha}...HEAD`]);
  const changedFiles = changedOutput === '' ? [] : changedOutput.split('\n').sort();
  const bar = barForChangedFiles(changedFiles);
  if (bar === 'scoped') {
    const directReaders = directReaderTestFiles(process.cwd(), changedFiles);
    const importSelections = listedFiles(changedTestListCommand(baseSha, MERGE_ONLY_PROJECTS));
    const directSelections =
      directReaders.length === 0
        ? []
        : listedFiles(directTestListCommand(directReaders, MERGE_ONLY_PROJECTS));
    const plan = gatePlan(changedFiles, [], [...importSelections, ...directSelections]);
    if (plan.mergeTestFiles.length === 0) {
      process.stdout.write(
        `gate: scoped simulation gate skipped — no balance or calibration test is related to ` +
          `${changedFiles.join(', ') || '(no changed files)'}\n`,
      );
      return 0;
    }
    const command = relatedTestCommand(changedFiles, directReaders, MERGE_ONLY_PROJECTS);
    process.stdout.write(
      `gate: scoped simulation gate selected ${plan.mergeTestFiles.length} test file(s): ${plan.mergeTestFiles.join(', ')}\n` +
        `gate: ${command.join(' ')}\n`,
    );
    return run(command);
  }

  const command = mergeTestCommand();
  process.stdout.write(
    `gate: full simulation gate — ${MERGE_ONLY_PROJECTS.join(' and ')}, the projects every lane ` +
      `skips. Nothing merges without this green.\ngate: ${command.join(' ')}\n`,
  );
  return run(command);
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
