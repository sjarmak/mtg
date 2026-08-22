/**
 * One writer per worktree, decided rather than assumed.
 *
 * Orchestrated waves give every lane its own worktree so two agents editing one
 * file cannot collide, and the whole isolation argument rests on an assumption
 * nothing checks: that a worktree has exactly one agent in it. On 2026-08-20 the
 * host exited mid-wave and the lanes were resumed by message. One lane found a
 * test file appearing in its worktree that it had not written, from a concurrent
 * twin of itself the restart had spawned (`mtg-cb2e`). That file survived review
 * and nothing was lost, but two processes writing one checkout is the shape that
 * loses work, and it loses it silently: the loser is whichever write lands
 * second, and neither side ever sees the other.
 *
 * So a lane claims its worktree before it writes, and the discriminant is the
 * agent id. A resume of a lane carries the id the lane already had; a twin
 * spawned beside it does not. That is the whole judgment, and it is deliberately
 * the whole judgment:
 *
 * **There is no liveness probe, and a pid would be worse than nothing here.**
 * The writer is an agent, not the process that runs this command — the claim is
 * taken by a one-shot `npx tsx` under a shell that has exited by the time
 * anything else looks. A stale-claim rule reading that pid would find it dead
 * every time and grant every twin, which is the failure this module exists to
 * refuse, wearing a check's clothing. A claim left behind by a lane that really
 * did die is cleared by the orchestrator with `--force`, in the sweep step
 * `AGENTS.md` already requires, by the one party that knows a lane is gone.
 *
 * This module is the judgment. `cli.ts` is the file IO, split the way `test-load/`
 * splits its judgment from its sampling: the decision table is the part worth
 * testing.
 */

/** A lane's recorded claim on a worktree. Written by the holder, read by everyone. */
export interface LaneClaim {
  /** The lane's name, which is the worktree's directory name (`n28`). */
  readonly lane: string;
  /**
   * The agent that holds it. A resume of the same agent carries the same id,
   * which is exactly what distinguishes a resume from a twin.
   */
  readonly agentId: string;
  /** When the claim was taken, ISO 8601. Reported, never compared. */
  readonly claimedAt: string;
  /** The agent this claim displaced, when it was forced. Reported, never compared. */
  readonly displaced?: string;
}

export type ClaimVerdict =
  | { readonly granted: true; readonly why: string; readonly displaced: LaneClaim | null }
  | { readonly granted: false; readonly why: string; readonly holder: LaneClaim };

/**
 * Who may write this worktree, given what is already claimed.
 *
 * The grants are three different events and the verdict says which, because a
 * forced grant is a crash being cleaned up and is worth printing next to the
 * name of whoever lost the tree.
 */
export function decideClaim(existing: LaneClaim | null, candidate: LaneClaim, forced: boolean): ClaimVerdict {
  if (existing === null) {
    return { granted: true, why: `${candidate.lane} was unclaimed`, displaced: null };
  }
  if (existing.agentId === candidate.agentId) {
    return {
      granted: true,
      why: `${candidate.agentId} already holds ${candidate.lane}, so this is a resume rather than a second writer`,
      displaced: null,
    };
  }
  if (forced) {
    return {
      granted: true,
      why:
        `${candidate.agentId} took ${candidate.lane} from ${existing.agentId}, which claimed it at ` +
        `${existing.claimedAt}. Forcing is the orchestrator saying that lane is gone.`,
      displaced: existing,
    };
  }
  return {
    granted: false,
    why:
      `${existing.agentId} is writing ${existing.lane}, claimed at ${existing.claimedAt}. Two agents ` +
      `in one worktree lose whichever write lands second, so this one stops rather than racing ` +
      `(mtg-cb2e). Resume the holder instead of spawning beside it, or force the claim if that lane ` +
      `is known to be gone.`,
    holder: existing,
  };
}

/**
 * Whether this agent may drop the claim.
 *
 * A release is not a claim run backwards: an agent that never held the worktree
 * releasing it would hand the tree to a twin, which is the failure this module
 * exists to stop.
 */
export function mayRelease(existing: LaneClaim | null, agentId: string): boolean {
  return existing !== null && existing.agentId === agentId;
}
