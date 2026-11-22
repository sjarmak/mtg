/**
 * ```
 * npm run stalled-work            # fetches origin/main, then reports
 * npm run stalled-work -- --no-fetch   # skips the fetch; says so up front
 * ```
 *
 * Runs beside `npm run queue`, costs no test suite, and a clean run (every
 * local `work/*` branch is an ancestor of `origin/main`) prints nothing. A branch
 * confirmed landed under a different sha is not a finding but is still named,
 * so it prints under its own heading rather than vanishing.
 *
 * Stale local refs are the trap `mtg-r7y1`'s own check nearly fell into: this
 * fetches `origin/main` before reading anything, unless told not to, in which
 * case it says so rather than reporting silently against a checkout that may
 * be behind.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  ancestorVerdict,
  classifyBranches,
  isClean,
  parseBeadShow,
  type BeadLookup,
  type BranchState,
  type CommandResult,
  type StalledWorkReport,
} from './stalled-work';

function run(command: string, args: readonly string[]): CommandResult {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function git(args: readonly string[]): string {
  const result = run('git', args);
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed (exit ${result.status}): ${result.stderr.trim() || 'no stderr'}`);
  }
  return result.stdout;
}

function localWorkBranches(): readonly string[] {
  return git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/work/*'])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function isAncestorOfOriginMain(branch: string): boolean {
  return ancestorVerdict(run('git', ['merge-base', '--is-ancestor', branch, 'origin/main']));
}

/** A regex-special character in a branch name, escaped so the grep matches it literally. */
function escapeForRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The sha of a commit on `origin/main` whose subject line reads exactly `Merge <branch>`, or null. */
function recutMergeSha(branch: string): string | null {
  const out = git([
    'log',
    'origin/main',
    '--format=%H',
    '--extended-regexp',
    `--grep=^Merge ${escapeForRegex(branch)}$`,
    '-1',
  ]).trim();
  return out.length > 0 ? out : null;
}

function branchState(branch: string): BranchState {
  const isAncestor = isAncestorOfOriginMain(branch);
  return {
    branch,
    isAncestor,
    recutMergeSha: isAncestor ? null : recutMergeSha(branch),
  };
}

function beadOf(beadId: string): BeadLookup | null {
  return parseBeadShow(run('bd', ['show', beadId, '--json']));
}

function report(result: StalledWorkReport): void {
  if (result.unlanded.length > 0) {
    console.log(`\nSTALLED — closed bead, branch not confirmed landed (${result.unlanded.length})`);
    for (const finding of result.unlanded) {
      console.log(`  ${finding.beadId.padEnd(20)}${finding.branch}`);
    }
  }
  if (result.recutDuplicates.length > 0) {
    console.log(
      `\nRE-CUT DUPLICATE — content already on origin/main under a different sha (${result.recutDuplicates.length})`,
    );
    for (const dup of result.recutDuplicates) {
      console.log(`  ${dup.branch.padEnd(28)}landed as ${dup.mergeSha.slice(0, 9)}`);
    }
  }
  if (result.orphans.length > 0) {
    console.log(
      `\nQUESTION — branch traces to no bead, unconfirmed on origin/main (${result.orphans.length})`,
    );
    for (const orphan of result.orphans) {
      console.log(`  ${orphan.branch}`);
    }
  }
}

function main(): void {
  const fetch = !process.argv.includes('--no-fetch');
  if (fetch) {
    execFileSync('git', ['fetch', 'origin', 'main', '--quiet'], { stdio: ['ignore', 'ignore', 'inherit'] });
  } else {
    console.log('NOT FETCHED — origin/main may be stale; rerun without --no-fetch to fetch first');
  }

  const branches = localWorkBranches();
  const states = branches.map((branch) => branchState(branch));
  const result = classifyBranches(states, beadOf);

  if (isClean(result)) return;
  report(result);
}

main();
