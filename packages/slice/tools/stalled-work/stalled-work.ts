/**
 * Finding the stall the playtester ruled invisible: a bead closed while its commit
 * sits only on a branch `origin/main` never took.
 *
 * The playtester ruled 2026-09-18 that finished work nobody has landed is a stall,
 * and that this is the one status views cannot show: `bd` calls the bead done
 * the moment it closes, whether or not the commit ever reached `origin/main`.
 * Each catch so far has been luck (`mtg-yhjds` was found only because an
 * unrelated worktree audit happened to list branches).
 *
 * The naive check -- every `work/*` branch that is not an ancestor of
 * `origin/main` -- over-reports badly: measured 2026-09-21, six of nine
 * flagged branches had already landed. A re-slung lane re-cuts its branch off
 * the current `origin/HEAD`, so the tip that merged and the tip that exists
 * now carry the same content under different shas, and an ancestor test is a
 * sha test. A checker that flags six false positives out of nine gets
 * ignored, which is the same failure as not having one, so this module keeps
 * two branches apart: content confirmed landed under another sha (a rename,
 * not a finding) and everything else, which it still names rather than drops.
 *
 * `cli.ts` runs `git` and `bd` and prints. This module is the classification and
 * the reading of what those two commands answered, which is the part worth
 * testing without a live checkout.
 */
import { z } from 'zod';

/** One local `work/*` branch and what the two git checks found for it. */
export interface BranchState {
  readonly branch: string;
  /** `git merge-base --is-ancestor <branch> origin/main`. */
  readonly isAncestor: boolean;
  /**
   * The sha of a commit on `origin/main` whose subject reads `Merge <branch>`,
   * when one exists. Proves the branch's content landed under a different tip;
   * null does not prove the opposite, only that this check found no proof.
   */
  readonly recutMergeSha: string | null;
}

/** What `bd show <id> --json` answered, narrowed to what classification reads. */
export interface BeadLookup {
  readonly id: string;
  readonly status: string;
}

export interface UnlandedFinding {
  readonly branch: string;
  readonly beadId: string;
}

export interface RecutDuplicate {
  readonly branch: string;
  readonly mergeSha: string;
}

export interface OrphanBranch {
  readonly branch: string;
}

export interface StalledWorkReport {
  /** A closed bead whose branch carries content this check could not confirm on `origin/main`. */
  readonly unlanded: readonly UnlandedFinding[];
  /** Not a finding: content already on `origin/main`, confirmed by a matching merge commit. */
  readonly recutDuplicates: readonly RecutDuplicate[];
  /** A branch that is neither confirmed landed nor traceable to a bead. Named, not dropped. */
  readonly orphans: readonly OrphanBranch[];
}

/** What a finished child process answered. `status` is null when it never ran to an exit code. */
export interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const BeadRowSchema = z.object({ id: z.string().min(1), status: z.string().min(1) });

/**
 * `git merge-base --is-ancestor` answers 0 (is) or 1 (is not). Anything else --
 * a missing `origin/main`, a bad ref -- is a failure, and reading it as "not an
 * ancestor" would report every branch as unlanded against a checkout that
 * cannot answer.
 */
export function ancestorVerdict(run: CommandResult): boolean {
  if (run.status === 0) return true;
  if (run.status === 1) return false;
  throw new Error(
    `git merge-base --is-ancestor failed (exit ${run.status}): ${run.stderr.trim() || 'no stderr'}`,
  );
}

/**
 * `bd show <id> --json`. Null only for a bead `bd` says does not exist. Every
 * other failure (an unreachable Dolt server exits 1 exactly as a missing bead
 * does) throws, because reading it as "no such bead" would print every
 * unlanded branch as an orphan and call `bd` being down a finding.
 */
export function parseBeadShow(run: CommandResult): BeadLookup | null {
  if (run.status === 1 && /not found/i.test(run.stderr)) return null;
  if (run.status !== 0) {
    throw new Error(`bd show failed (exit ${run.status}): ${run.stderr.trim() || 'no stderr'}`);
  }
  const rows = z.array(BeadRowSchema).safeParse(JSON.parse(run.stdout));
  if (!rows.success) {
    throw new Error(
      `bd show did not answer with a bead: ${rows.error.issues[0]?.message ?? 'unknown shape'}`,
    );
  }
  const [row] = rows.data;
  if (row === undefined) throw new Error('bd show answered with no bead and no error');
  return row;
}

/** `work/mtg-76nd4` -> `mtg-76nd4`, this lane's one naming convention for a work branch. */
export function branchToBeadId(branch: string): string {
  return branch.replace(/^work\//, '');
}

export function isClean(report: StalledWorkReport): boolean {
  return report.unlanded.length === 0 && report.recutDuplicates.length === 0 && report.orphans.length === 0;
}

/**
 * Sorts each branch state into exactly one bucket, or none.
 *
 * An ancestor branch is silently fine -- it landed, there is nothing to say.
 * Everything else was NOT proven to have landed, and this function decides
 * only what to call that: a recut duplicate when the merge-grep confirms the
 * content is on `origin/main` regardless; otherwise an unlanded finding when
 * the branch traces to a CLOSED bead (the actionable case, "land it"); an open
 * or in-progress bead is expected in-flight work and is not reported; and a
 * branch tracing to no bead at all is an orphan, named rather than filtered,
 * because a second-worktree cut or a superseded child is a question for a
 * person, not a result this check can resolve on its own.
 */
export function classifyBranches(
  branches: readonly BranchState[],
  beadOf: (beadId: string) => BeadLookup | null,
): StalledWorkReport {
  const unlanded: UnlandedFinding[] = [];
  const recutDuplicates: RecutDuplicate[] = [];
  const orphans: OrphanBranch[] = [];

  for (const state of branches) {
    if (state.isAncestor) continue;

    if (state.recutMergeSha !== null) {
      recutDuplicates.push({ branch: state.branch, mergeSha: state.recutMergeSha });
      continue;
    }

    const beadId = branchToBeadId(state.branch);
    const bead = beadOf(beadId);
    if (bead === null) {
      orphans.push({ branch: state.branch });
      continue;
    }
    if (bead.status === 'closed') {
      unlanded.push({ branch: state.branch, beadId: bead.id });
    }
  }

  return { unlanded, recutDuplicates, orphans };
}
