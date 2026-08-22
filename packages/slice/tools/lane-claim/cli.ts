/**
 * The file behind `decideClaim`.
 *
 * A lane runs `claim` as its first command and `release` as its last:
 *
 * ```
 * npx tsx packages/slice/tools/lane-claim/cli.ts claim <worktree-path> <agent-id>
 * npx tsx packages/slice/tools/lane-claim/cli.ts release <worktree-path> <agent-id>
 * ```
 *
 * A refusal exits 1 and names the holder, so a lane prompt can make it the first
 * line and a twin stops before it writes anything. `show` reports without
 * deciding, which is what a sweep wants, and `--force` is the orchestrator's
 * override for a lane it knows is gone.
 *
 * The claim lives at `<worktree>/.lane-claim.json`, inside the worktree rather
 * than in a registry beside it, because a worktree that is removed takes its
 * claim with it and there is no second place left holding a stale row.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { type LaneClaim, decideClaim, mayRelease } from './claim';

const CLAIM_FILE = '.lane-claim.json';

const LaneClaimSchema = z.object({
  lane: z.string().min(1),
  agentId: z.string().min(1),
  claimedAt: z.string().min(1),
  displaced: z.string().min(1).optional(),
});

export function claimPath(worktree: string): string {
  return resolve(worktree, CLAIM_FILE);
}

/** The claim on a worktree, or `null` when there is none. A malformed one throws. */
export function readClaim(worktree: string): LaneClaim | null {
  const path = claimPath(worktree);
  if (!existsSync(path)) return null;
  const parsed = LaneClaimSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) {
    throw new Error(
      `${path} is not a lane claim: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`,
    );
  }
  // Rebuilt rather than returned: under `exactOptionalPropertyTypes` an absent
  // `displaced` and one present as `undefined` are different types.
  const { displaced, ...rest } = parsed.data;
  return displaced === undefined ? rest : { ...rest, displaced };
}

/** The lane's name, which is the worktree directory's own name. */
export function laneName(worktree: string): string {
  const parts = resolve(worktree).split('/');
  return parts[parts.length - 1] ?? worktree;
}

function usage(): never {
  process.stderr.write(
    'usage: lane-claim <claim|release|show> <worktree-path> [agent-id] [--force]\n' +
      '  claim   takes the worktree for this agent, or exits 1 naming the holder\n' +
      "  release drops this agent's own claim; another agent's claim is left alone\n" +
      '  show    prints the current claim without deciding anything\n' +
      '  --force takes a claim from another agent, for an orchestrator sweeping a dead lane\n',
  );
  process.exit(2);
}

export function main(argv: readonly string[]): void {
  const forced = argv.includes('--force');
  const positional = argv.filter((arg) => arg !== '--force');
  const [verb, worktree, agentId] = positional;
  if (verb === undefined || worktree === undefined) usage();
  if (!existsSync(resolve(worktree))) {
    process.stderr.write(`no such worktree: ${resolve(worktree)}\n`);
    process.exit(2);
  }
  const existing = readClaim(worktree);

  if (verb === 'show') {
    process.stdout.write(
      existing === null
        ? `${laneName(worktree)} is unclaimed\n`
        : `${existing.lane} is claimed by ${existing.agentId}, taken at ${existing.claimedAt}\n`,
    );
    return;
  }
  if (agentId === undefined) usage();

  if (verb === 'release') {
    if (!mayRelease(existing, agentId)) {
      process.stdout.write(`${laneName(worktree)} is not held by ${agentId}; nothing released\n`);
      return;
    }
    rmSync(claimPath(worktree));
    process.stdout.write(`${agentId} released ${laneName(worktree)}\n`);
    return;
  }
  if (verb !== 'claim') usage();

  const candidate: LaneClaim = {
    lane: laneName(worktree),
    agentId,
    claimedAt: new Date().toISOString(),
  };
  const verdict = decideClaim(existing, candidate, forced);
  if (!verdict.granted) {
    process.stderr.write(`refused: ${verdict.why}\n`);
    process.exit(1);
  }
  const written =
    verdict.displaced === null ? candidate : { ...candidate, displaced: verdict.displaced.agentId };
  writeFileSync(claimPath(worktree), `${JSON.stringify(written, null, 2)}\n`, 'utf8');
  process.stdout.write(`${agentId} holds ${candidate.lane}: ${verdict.why}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
