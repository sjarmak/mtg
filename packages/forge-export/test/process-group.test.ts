/**
 * A detached Forge group must not outlive the Node process that spawned it
 * (mtg-2joqn). Each case runs a child Node process that spawns a stub group
 * (a shell that sleeps) through `trackProcessGroup`, then either exits or is
 * signaled without ever calling `killProcessGroup`, and asserts the group is
 * gone. Revert check: with the handlers removed from `install()` these fail.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const MODULE = resolve(__dirname, '../src/process-group.ts');

const CHILD = `
import { spawn } from 'node:child_process';
import { trackProcessGroup } from ${JSON.stringify(MODULE)};
const stub = spawn('sh', ['-c', 'sleep 300 & wait'], { detached: true, stdio: 'ignore' });
trackProcessGroup(stub.pid);
process.stdout.write('pgid=' + String(stub.pid) + '\\n');
if (process.argv[2] === 'exit') {
  // Wait for the harness to confirm the group is alive before self-exiting,
  // otherwise the exit handler's reap can race the harness's own liveness
  // check (both fire within the same tick, with no ordering guarantee).
  process.stdin.once('data', () => process.exit(0));
  process.stdin.resume();
} else {
  setInterval(() => {}, 1000);
}
`;

function isGroupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const dir = mkdtempSync(join(tmpdir(), 'process-group-'));
const script = join(dir, 'owner.mts');
writeFileSync(script, CHILD);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function run(mode: 'exit' | 'SIGTERM' | 'SIGINT'): Promise<{ pgid: number; alive: boolean }> {
  const child = spawn(process.execPath, ['--import', 'tsx', script, mode], {
    cwd: resolve(__dirname, '..'),
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  let out = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => (out += chunk));
  await waitFor(() => /pgid=\d+/.test(out), 20_000);
  const pgid = Number(/pgid=(\d+)/.exec(out)?.[1]);
  expect(isGroupAlive(pgid)).toBe(true);
  const closed = new Promise<void>((r) => child.once('close', () => r()));
  if (mode === 'exit') child.stdin.write('go');
  else child.kill(mode);
  await closed;
  try {
    await waitFor(() => !isGroupAlive(pgid), 3_000);
    return { pgid, alive: false };
  } catch {
    process.kill(-pgid, 'SIGKILL');
    return { pgid, alive: true };
  }
}

describe('process-group registry', () => {
  it.each(['exit', 'SIGTERM', 'SIGINT'] as const)(
    'reaps a tracked group when the owner ends by %s',
    async (mode) => {
      expect((await run(mode)).alive).toBe(false);
    },
    40_000,
  );
});
