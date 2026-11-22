import { spawnSync } from 'node:child_process';
import { hostname } from 'node:os';
import { basename, resolve } from 'node:path';
import {
  POLL_INTERVAL_MS,
  acquireOrWait,
  release,
  sleepSync,
  suiteHolderIsLive,
  testLockPath,
  type LockHolder,
} from './host-lock';

function defaultLabel(): string {
  return `${basename(resolve('.'))} (npm test) pid ${process.pid} on ${hostname()}`;
}

function describeWait(holder: LockHolder): string {
  return (
    `test: another full suite on this host is running (${holder.label}, since ${holder.startedAt}); ` +
    'waiting for it to exit rather than contending for the same cores.\n'
  );
}

export interface RunOptions {
  readonly sleep?: (ms: number) => void;
  readonly spawn?: typeof spawnSync;
  readonly label?: string;
}

export function main(argv: readonly string[], options: RunOptions = {}): number {
  const sepIndex = argv.indexOf('--');
  const command = sepIndex === -1 ? [] : argv.slice(sepIndex + 1);
  if (command.length === 0) {
    process.stderr.write('usage: with-lock.ts [--label <text>] -- <command> [args...]\n');
    return 2;
  }

  const path = testLockPath();
  const label = options.label ?? defaultLabel();
  const spawn = options.spawn ?? spawnSync;

  const outcome = acquireOrWait(path, label, {
    deadlineMs: Number.POSITIVE_INFINITY,
    pollMs: POLL_INTERVAL_MS,
    sleep: options.sleep ?? sleepSync,
    isLive: suiteHolderIsLive,
    onWaiting: (holder) => process.stdout.write(describeWait(holder)),
  });
  if (!outcome.acquired) {
    throw new Error('test suite lock wait ended without acquiring the lock');
  }

  try {
    const [bin, ...args] = command;
    if (bin === undefined) throw new Error('empty command');
    const result = spawn(bin, args, { stdio: 'inherit' });
    if (result.error) throw result.error;
    return result.status ?? 1;
  } finally {
    release(path);
  }
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
