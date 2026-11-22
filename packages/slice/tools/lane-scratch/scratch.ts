/**
 * Where a lane's gate output goes, so a sibling lane cannot land on top of it.
 *
 * Concurrent lanes wrote their evidence to one scratchpad path: the reporter
 * name was the whole of the filename, so a second lane running the same gate
 * overwrote the first lane's log with its own, and the loser read a green
 * summary that belonged to somebody else's tree (`mtg-8h0g`). It is the failure
 * `lane-claim/` refuses one directory over, one layer down: two writers, one
 * name, and nothing between them.
 *
 * The fix is a path rather than a lock. A lane's scratch directory is derived
 * from the lane and the agent holding it, so two lanes never name one file and
 * a twin of one lane never names its parent's — and derived, not handed out, so
 * a gate that writes somewhere else is a gate somebody wrote wrong rather than
 * a gate that was pointed wrong today. That is the same reason `lane-claim`'s
 * discriminant is the agent id: a resume of a lane carries the id it had and
 * comes back to its own evidence.
 *
 * **The agent id is in the path even though a twin is already refused.** The
 * claim stops a twin from *writing the worktree*, and a gate's scratch output
 * is not in the worktree — it is under the session scratchpad, which no claim
 * covers. A twin refused at the door still runs its own `vitest` somewhere. So
 * the scratch path carries both, and the two mechanisms fail independently.
 *
 * This module is the derivation and the refusals. `cli.ts` is the file IO, split
 * the way `lane-claim/` splits its judgment from its writes: the decision is the
 * part worth testing.
 */
import { resolve } from 'node:path';

/**
 * What may appear in a lane name or an agent id on the way into a path.
 *
 * Deliberately narrower than a filename: a lane is a worktree directory name
 * (`n28`) and an agent id is a token an orchestrator minted, so anything with a
 * separator, a space or a leading dot in it is a mistake rather than an unusual
 * name. Refusing is cheap and the alternative is a traversal written by a
 * caller who meant nothing by it.
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The lane whose evidence a scratch directory holds. */
export interface LaneScratch {
  /** The lane's name, which is its worktree directory's name. */
  readonly lane: string;
  /** The agent holding the lane, the same id `lane-claim` decides with. */
  readonly agentId: string;
}

/**
 * A refusal, said in the words the caller needs to fix it.
 *
 * Thrown rather than returned, because every caller of `laneScratchDir` is
 * about to write a file: there is no useful way to carry on with a name that
 * was refused, and a gate that swallowed this would write to the shared path
 * again.
 */
export class LaneScratchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LaneScratchError';
  }
}

function checkSegment(kind: string, value: string): string {
  if (!SEGMENT.test(value)) {
    throw new LaneScratchError(
      `${kind} ${JSON.stringify(value)} cannot be part of a path: it must start with a letter or ` +
        `digit and hold only letters, digits, dot, dash and underscore. A separator or a leading ` +
        `dot here would put one lane's output beside, or on top of, another's.`,
    );
  }
  return value;
}

/**
 * The directory this lane writes its gate output to.
 *
 * `<root>/lanes/<lane>/<agent id>`. Two levels rather than one joined name so a
 * sweep can remove a whole lane by removing one directory, and so a listing
 * reads as the wave it came from.
 */
export function laneScratchDir(root: string, lane: LaneScratch): string {
  if (root.trim() === '') throw new LaneScratchError('a scratch root is required and was empty');
  return resolve(root, 'lanes', checkSegment('lane', lane.lane), checkSegment('agent id', lane.agentId));
}

/** A file inside this lane's directory. The name is checked the same way the lane is. */
export function laneScratchFile(root: string, lane: LaneScratch, name: string): string {
  return resolve(laneScratchDir(root, lane), checkSegment('file name', name));
}

/**
 * Whether a path is this lane's to write.
 *
 * The question a gate asks about a path it was handed rather than one it
 * derived. A path outside the lane's own directory is another lane's evidence
 * or the shared root itself, and both are the bug.
 */
export function ownedByLane(root: string, lane: LaneScratch, path: string): boolean {
  const own = laneScratchDir(root, lane);
  const candidate = resolve(path);
  return candidate === own || candidate.startsWith(`${own}/`);
}

/**
 * The one line a gate prints so the location is visible where the output is.
 *
 * A gate that writes somewhere nobody named is how the shared path survived as
 * long as it did: every lane's log was in the same place and no lane's output
 * ever said where.
 */
export function describeScratch(root: string, lane: LaneScratch): string {
  return `${lane.lane} (${lane.agentId}) writes gate output to ${laneScratchDir(root, lane)}`;
}
