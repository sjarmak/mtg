/**
 * The file IO behind `laneScratchDir`.
 *
 * A lane asks for its directory once and passes it to whatever writes:
 *
 * ```
 * OUT=$(npx tsx packages/slice/tools/lane-scratch/cli.ts path <lane> <agent-id> --create)
 * npx vitest run --project unit packages/slice > "$OUT/unit.log" 2>&1
 * ```
 *
 * `path` prints the directory and nothing else, so it composes in a shell. It is
 * the only verb that prints a bare path; `describe` prints the sentence a gate
 * puts in its own output, and `check` answers whether a path a lane was handed
 * is that lane's to write, which is the question worth asking about a path that
 * arrived in an environment variable.
 *
 * The root is `--root` or `MTG_SCRATCH_ROOT`, and there is no default. A default
 * would be a shared path with a nicer name: the whole failure is that every lane
 * agreed on one location without anybody choosing it (`mtg-8h0g`).
 */
import { mkdirSync } from 'node:fs';
import type { LaneScratch } from './scratch';
import { LaneScratchError, describeScratch, laneScratchDir, ownedByLane } from './scratch';

function usage(): never {
  process.stderr.write(
    'usage: lane-scratch <path|describe|check> <lane> <agent-id> [candidate] [--root <dir>] [--create]\n' +
      "  path      prints this lane's own directory, and nothing else\n" +
      '  describe  prints the sentence a gate should put beside its output\n' +
      "  check     exits 0 when <candidate> is inside this lane's directory, 1 when it is not\n" +
      '  --root    the scratch root; MTG_SCRATCH_ROOT is read when the flag is absent\n' +
      '  --create  make the directory before printing it\n',
  );
  process.exit(2);
}

interface Parsed {
  readonly verb: string;
  readonly lane: LaneScratch;
  readonly candidate: string | undefined;
  readonly root: string;
  readonly create: boolean;
}

export function parseArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Parsed {
  const create = argv.includes('--create');
  const rest = [...argv].filter((arg) => arg !== '--create');
  const flag = rest.indexOf('--root');
  const rootFlag = flag === -1 ? undefined : rest[flag + 1];
  if (flag !== -1) {
    if (rootFlag === undefined) usage();
    rest.splice(flag, 2);
  }
  const [verb, lane, agentId, candidate] = rest;
  if (verb === undefined || lane === undefined || agentId === undefined) usage();
  const root = rootFlag ?? env['MTG_SCRATCH_ROOT'] ?? '';
  if (root === '') {
    process.stderr.write(
      'no scratch root: pass --root <dir> or set MTG_SCRATCH_ROOT. There is deliberately no default, ' +
        'because a default is the shared path this tool exists to replace.\n',
    );
    process.exit(2);
  }
  return { verb, lane: { lane, agentId }, candidate, root, create };
}

export function main(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const { verb, lane, candidate, root, create } = parseArgs(argv, env);
  try {
    if (verb === 'describe') {
      process.stdout.write(`${describeScratch(root, lane)}\n`);
      return;
    }
    if (verb === 'check') {
      if (candidate === undefined) usage();
      if (ownedByLane(root, lane, candidate)) {
        process.stdout.write(`${candidate} is ${lane.lane}'s to write\n`);
        return;
      }
      process.stderr.write(
        `${candidate} is outside ${laneScratchDir(root, lane)}, so it is another lane's evidence or ` +
          `the shared root itself\n`,
      );
      process.exit(1);
    }
    if (verb !== 'path') usage();
    const directory = laneScratchDir(root, lane);
    if (create) mkdirSync(directory, { recursive: true });
    process.stdout.write(`${directory}\n`);
  } catch (error: unknown) {
    if (error instanceof LaneScratchError) {
      process.stderr.write(`refused: ${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
