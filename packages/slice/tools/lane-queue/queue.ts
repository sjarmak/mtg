/**
 * Which UI bead an agent may take next, decided rather than chosen.
 *
 * The UI backlog is about sixty open beads and most of them cannot be worked
 * without the playtester, which is not obvious from priority: the ready ones are
 * mostly P2 and P3 and the blocked ones are mostly P1. An agent handed the list
 * sorted by priority walks straight into the four or five that are a design
 * question wearing a bug's clothing, spends a lane arguing itself into an
 * answer, and produces a change nobody asked for. So the backlog carries an
 * admission label per bead and this module reads it. The labels are the record;
 * the ordering below is derived from them and from nothing else.
 *
 * **The admission rule**, applied by hand once per bead and then written down:
 *
 * 1. The bead's body states the fix, or the defect has exactly one repair
 *    consistent with a rule already written down in `AGENTS.md`, `CLAUDE.md`,
 *    `DESIGN.md` or an ADR.
 * 2. The fix does not trade one legibility for another. Almost every blocked UI
 *    bead fails this clause and no other: the board's height, the step bar's
 *    lines and the rail's width are one budget, and a bead that buys a readable
 *    hand by cutting the battlefield is asking which one the playtester would rather
 *    read, not how to write it.
 * 3. It spends nothing and leaves nothing outside this machine. A metered art
 *    backend, a push, a `gh` write: hers, per action, every time.
 *
 * A bead that clears all three is `ready/agent`. One that fails 1 or 2 is
 * `needs/the playtester` and its body must name the choice, because the point of the
 * label is that a decision sheet can be assembled from the beads themselves
 * rather than from somebody's memory of them. `blocked/device`, `blocked/env`
 * and `blocked/lane` are the three failures that are nobody's judgment: an iPad
 * this machine is not, a capability this machine does not have (`mtg-6hu8`:
 * headless Chrome here reaches `file://` and nothing else), and a file another
 * lane is holding an unintegrated commit over.
 *
 * `blocked/lane` was added on the day it was paid for twice. `mtg-isbc`'s whole
 * remaining scope is two edits to `read-log.ts` and `log-schema.ts`, and commit
 * `41fa1313` on `codex/rtr-overload-integrate` rewrites both; a session claimed
 * it, read the branch, and released it, and the next session was handed the same
 * bead and did the same reading. That is not a bead whose fix is unclear or whose
 * tradeoff is the playtester's — the work is written down and correct — it is a bead
 * that cannot be *landed* here without making a conflict for a lane one commit
 * from integrating. A bead carrying it must name the branch and the commit in its
 * body, for `needs/the playtester`'s reason: the claim is checkable, and the check is
 * `git merge-base --is-ancestor <commit> main`, which is how it comes off again.
 *
 * **A parent is not a blocker.** `bd blocked` counts a parent-child edge as a
 * dependency, and every bead in this lane hangs under an open epic, so reading
 * that answer literally hides the whole backlog — `mtg-brd8` is a P0 whose fix
 * is already written and which `bd ready` will not name while `mtg-yp33` is
 * open. So a blocker that is the bead's own parent is dropped here, and every
 * other one holds the bead and is named in the holding.
 *
 * **Untriaged is a first-class answer.** A bead in the lane carrying no
 * admission label is reported, loudly, rather than dropped. That is the whole
 * reason this is a program and not a list in a document: a list written today is
 * wrong the first time somebody files a bead, and it is wrong silently.
 *
 * **The pixel constraint belongs to the machine, not to this lane.** A bead
 * labeled `serial/pixels` and not `ui` is reported in its own section rather
 * than filtered out with everything else outside the lane, and while one of them
 * is in flight it holds the lane's pixel queue the same way one of ours would.
 * Two beads were found by hand on 2026-09-04 carrying `serial/pixels` and an
 * admission label and no `ui` — `mtg-9uhe` and `mtg-txde`, both of them
 * packages/ui bugs with their fix already written down — and the queue printed
 * them in no section at all, which is the one outcome the untriaged rule below
 * exists to prevent and could not reach: a bead missing the lane label is not
 * unlabeled to this program, it is absent. The section is deliberately not a
 * second lane. It admits nothing and hands out nothing; it says a browser
 * measurement is being asked for from outside, which is either a mislabel to
 * repair or a second lane sharing the one box, and both are things a reader has
 * to be told rather than a judgment this file can make.
 *
 * **One pixel lane at a time**, which is the constraint the machine imposes and
 * the one most likely to be forgotten. `packages/slice/tools/test-load/` exists
 * because this box runs several lanes at once and a browser measurement taken
 * under that load is a fact about the queue rather than about the sheet: four
 * `packages/ui/test/play` suites and three unit tests are already known to go
 * red that way (`mtg-wknz`, `mtg-60ae`). A bead whose verification is a browser
 * measurement is labeled `serial/pixels`, and while one of them is claimed the
 * rest are held. This is `lane-claim`'s judgment pointed at a different scarce
 * resource: there, one writer per worktree; here, one measurer per machine.
 *
 * This module is the judgment. `cli.ts` runs `bd` and prints. The split is
 * `lane-claim`'s and `test-load`'s: the decision table is the part worth testing.
 */

/** The admission labels. One per bead in the lane; more than one is a conflict. */
export const ADMISSION_LABELS = [
  'ready/agent',
  'needs/the playtester',
  'blocked/device',
  'blocked/env',
  'blocked/lane',
] as const;

/** The label that puts a bead in this lane at all. */
export const LANE_LABEL = 'ui';

/** The label that says verifying this bead is a browser measurement. */
export const SERIAL_LABEL = 'serial/pixels';

export type Admission = (typeof ADMISSION_LABELS)[number];

/** What `bd list --json` gives us, narrowed to the fields a queue reads. */
export interface QueueIssue {
  readonly id: string;
  readonly title: string;
  readonly priority: number;
  readonly status: string;
  readonly issueType: string;
  readonly labels: readonly string[];
  /** The bead this one hangs under, when it has one. */
  readonly parent: string | null;
  /** The bead's body. Read for the branch a `blocked/lane` bead names, and nothing else. */
  readonly body: string;
}

/** The branch and commit a `blocked/lane` body names, in either convention seen in this lane. */
const LANE_BLOCK_BRANCH_PATTERN = /(work\/[\w.-]+)`?,?\s+(?:at|head)\s+`?([0-9a-f]{7,40})\b/i;

/**
 * The branch a `blocked/lane` bead names as the thing holding it, or null when it names none.
 *
 * `mtg-r7y1`'s whole rule is that the label names a branch "because the check that takes it
 * off again is then one command" -- so this only trusts a `work/...` branch, this lane's own
 * naming convention, rather than matching any word near "at" or "head" in free-form prose.
 */
export function laneBlockBranch(body: string): { readonly branch: string; readonly commit: string } | null {
  const match = LANE_BLOCK_BRANCH_PATTERN.exec(body);
  return match ? { branch: match[1] ?? '', commit: match[2] ?? '' } : null;
}

/** A bead in the ready queue, with the reason it is or is not takeable right now. */
export interface QueueEntry {
  readonly issue: QueueIssue;
  readonly serial: boolean;
  /** Null when the bead is takeable now; otherwise why it is not, in a sentence. */
  readonly held: string | null;
}

export interface Queue {
  /** `ready/agent` beads in the order they should be taken. */
  readonly ready: readonly QueueEntry[];
  /** `needs/the playtester`, which is the decision sheet, highest priority first. */
  readonly decisions: readonly QueueIssue[];
  /** Every `blocked/*` kind, none of which a session here can move today. */
  readonly blocked: readonly QueueIssue[];
  /**
   * `blocked/lane` naming a branch that is already an ancestor of `origin/main`: the label was
   * right that the bead was blocked and is now wrong about why. Re-triage, never READY.
   */
  readonly staleLaneBlocks: readonly QueueIssue[];
  /**
   * `blocked/lane` naming no branch this queue can check. A separate, weaker failure than a
   * stale block -- `mtg-r7y1`'s whole point was that the label names a branch so a check exists.
   */
  readonly unresolvedLaneBlocks: readonly QueueIssue[];
  /** In the lane, carrying no admission label. A defect in the triage, not in the code. */
  readonly untriaged: readonly QueueIssue[];
  /** In the lane, carrying two admission labels. Refused rather than resolved. */
  readonly conflicted: readonly QueueIssue[];
  /**
   * Outside the lane and carrying `serial/pixels`: a browser measurement this
   * queue neither hands out nor holds, on the one machine it does hold.
   */
  readonly offLane: readonly QueueIssue[];
  /** Beads already in flight, which is what holds the pixel queue. */
  readonly inFlight: readonly QueueIssue[];
}

/**
 * Container beads are the lane's shape, not its work, so they are never handed
 * out and never counted as untriaged. A container is an epic, or any bead that
 * still has an open child — derived rather than declared, because the alternative
 * is a hand-kept exclusion list, and a list like that is wrong the first time
 * somebody files a child under a plain task and wrong without saying so.
 */
function isContainer(issue: QueueIssue, parents: ReadonlySet<string>): boolean {
  return issue.issueType === 'epic' || parents.has(issue.id);
}

function admissionOf(issue: QueueIssue): readonly Admission[] {
  return ADMISSION_LABELS.filter((label) => issue.labels.includes(label));
}

/**
 * The queue, given every open bead and what `bd blocked` says holds each one.
 *
 * `blockedBy` is `bd`'s answer rather than a second dependency resolver here,
 * and the only thing done to it is the parent rule above.
 */
export function buildQueue(
  issues: readonly QueueIssue[],
  blockedBy: ReadonlyMap<string, readonly string[]>,
  // Real I/O (a `git merge-base` shellout) has no business in a pure decision table, so the
  // caller does the checking and hands back only the yes/no this table needs.
  isLandedBranch: (branch: string) => boolean = () => false,
): Queue {
  const parents = new Set(issues.map((issue) => issue.parent).filter((id): id is string => id !== null));
  const lane = issues.filter((issue) => issue.labels.includes(LANE_LABEL));
  const byPriorityThenId = (a: QueueIssue, b: QueueIssue): number =>
    a.priority - b.priority || a.id.localeCompare(b.id);

  const untriaged: QueueIssue[] = [];
  const conflicted: QueueIssue[] = [];
  const admitted = new Map<Admission, QueueIssue[]>(ADMISSION_LABELS.map((label) => [label, []]));
  for (const issue of lane) {
    const labels = admissionOf(issue);
    const first = labels[0];
    if (labels.length > 1) conflicted.push(issue);
    else if (first !== undefined) admitted.get(first)?.push(issue);
    else if (!isContainer(issue, parents)) untriaged.push(issue);
  }

  const readyLane = (admitted.get('ready/agent') ?? [])
    .filter((issue) => !isContainer(issue, parents))
    .sort(byPriorityThenId);
  const inFlight = readyLane.filter((issue) => issue.status === 'in_progress');
  // Not `lane`: the scarce thing is this box, and a measurement claimed under
  // another label runs on it just the same.
  const offLane = issues
    .filter((issue) => !issue.labels.includes(LANE_LABEL) && issue.labels.includes(SERIAL_LABEL))
    .sort(byPriorityThenId);
  const pixelInFlight =
    inFlight.find((issue) => issue.labels.includes(SERIAL_LABEL)) ??
    offLane.find((issue) => issue.status === 'in_progress') ??
    null;

  let pixelHolder = pixelInFlight;
  const ready = readyLane
    .filter((issue) => issue.status !== 'in_progress')
    .map((issue): QueueEntry => {
      const serial = issue.labels.includes(SERIAL_LABEL);
      const blockers = (blockedBy.get(issue.id) ?? []).filter((id) => id !== issue.parent);
      if (blockers.length > 0) {
        return { issue, serial, held: `blocked by ${blockers.join(', ')}` };
      }
      if (!serial) return { issue, serial, held: null };
      if (pixelHolder !== null) {
        return {
          issue,
          serial,
          held:
            `${pixelHolder.id} is the pixel lane in flight, and a browser measurement taken beside ` +
            `another one measures the load (mtg-wknz, mtg-60ae)`,
        };
      }
      pixelHolder = issue;
      return { issue, serial, held: null };
    });

  const activeLaneBlocks: QueueIssue[] = [];
  const staleLaneBlocks: QueueIssue[] = [];
  const unresolvedLaneBlocks: QueueIssue[] = [];
  for (const issue of admitted.get('blocked/lane') ?? []) {
    const ref = laneBlockBranch(issue.body);
    if (ref === null) unresolvedLaneBlocks.push(issue);
    else if (isLandedBranch(ref.branch)) staleLaneBlocks.push(issue);
    else activeLaneBlocks.push(issue);
  }

  return {
    ready,
    decisions: (admitted.get('needs/the playtester') ?? []).slice().sort(byPriorityThenId),
    blocked: [
      ...(admitted.get('blocked/device') ?? []),
      ...(admitted.get('blocked/env') ?? []),
      ...activeLaneBlocks,
    ].sort(byPriorityThenId),
    staleLaneBlocks: staleLaneBlocks.sort(byPriorityThenId),
    unresolvedLaneBlocks: unresolvedLaneBlocks.sort(byPriorityThenId),
    untriaged: untriaged.slice().sort(byPriorityThenId),
    conflicted: conflicted.slice().sort(byPriorityThenId),
    offLane,
    inFlight,
  };
}

/** The one bead to take next, or null with the reason there is none. */
export function nextUp(queue: Queue): QueueEntry | null {
  return queue.ready.find((entry) => entry.held === null) ?? null;
}
