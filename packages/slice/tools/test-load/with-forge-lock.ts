/**
 * `npm run verify:live`'s wrapper: take the host-wide Forge-run lock
 * (`host-lock.ts`, under `forgeLockPath()`) before running the given command,
 * force `MTG_TEST_WORKERS=1` in its environment, and release the lock
 * whatever the command's exit code is.
 *
 * ```
 * npx tsx packages/slice/tools/test-load/with-forge-lock.ts -- npx tsx packages/ui/tools/live-journey.ts
 * ```
 *
 * The second clause of the playtester's lane ruling (2026-09-18 15:44Z): at most
 * one Forge-required run at a time on the host, with `MTG_TEST_WORKERS=1`.
 * `verify:live` drives every staged printed format through the real Forge
 * gateway and never runs vitest, so `forge-lock-setup.ts` (a Vitest global
 * setup) cannot reach it; this wrapper takes the identical lock directly
 * around the command, the same way `with-lock.ts` wraps `npm test` for the
 * full-suite lock.
 *
 * Unlike `with-lock.ts`, there is no `MTG_TEST_WORKERS` escape hatch here:
 * the ruling states no exception for a Forge-required run, so this always
 * waits for the lock and always forces the single-worker env on the child.
 */
import { spawnSync } from 'node:child_process';
import { hostname } from 'node:os';
import { basename, resolve } from 'node:path';
import { takeForgeLock } from './host-lock';

function defaultLabel(): string {
  return `${basename(resolve('.'))} (forge run) pid ${process.pid} on ${hostname()}`;
}

export interface RunOptions {
  readonly sleep?: (ms: number) => void;
  readonly spawn?: typeof spawnSync;
  readonly label?: string;
}

export function main(argv: readonly string[], options: RunOptions = {}): number {
  const sepIndex = argv.indexOf('--');
  const before = sepIndex === -1 ? argv : argv.slice(0, sepIndex);
  const command = sepIndex === -1 ? [] : argv.slice(sepIndex + 1);
  const labelIndex = before.indexOf('--label');
  const labelArg = labelIndex === -1 ? undefined : before[labelIndex + 1];
  if (command.length === 0 || (labelIndex !== -1 && labelArg === undefined)) {
    process.stderr.write('usage: with-forge-lock.ts [--label <text>] -- <command> [args...]\n');
    return 2;
  }

  const label = options.label ?? labelArg ?? defaultLabel();
  const spawn = options.spawn ?? spawnSync;

  const handle = takeForgeLock(label, {
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    onWaitOver: 'forge: the wait ran out; running anyway rather than waiting forever.\n',
  });

  try {
    const [bin, ...args] = command;
    if (bin === undefined) throw new Error('empty command');
    const result = spawn(bin, args, {
      stdio: 'inherit',
      env: { ...process.env, MTG_TEST_WORKERS: '1' },
    });
    if (result.error) throw result.error;
    return result.status ?? 1;
  } finally {
    handle.release();
  }
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
