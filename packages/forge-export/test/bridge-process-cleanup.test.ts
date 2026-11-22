/**
 * ForgeBridgeProcess.terminate() must reap the whole process tree, not just
 * its direct child. xvfb-run (the real command this wraps) is a shell script
 * that forks Xvfb as a background job and traps EXIT to kill it; SIGKILL to
 * the shell alone bypasses that trap and orphans Xvfb. This fakes that same
 * shape (a background grandchild plus an EXIT trap) to prove terminate()
 * reaps the grandchild too.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ForgeBridgeProcess } from '../src/observed/process';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
}

describe('ForgeBridgeProcess.terminate', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('kills a background grandchild an EXIT trap would otherwise be relied on to clean up', async () => {
    dir = mkdtempSync(join(tmpdir(), 'bridge-process-cleanup-'));
    const pidFile = join(dir, 'grandchild.pid');
    const script = [
      '(sleep 100) &',
      'GRANDCHILD=$!',
      `echo $GRANDCHILD > "${pidFile}"`,
      'trap "kill $GRANDCHILD 2>/dev/null" EXIT',
      'sleep 100',
    ].join('\n');

    const bridge = new ForgeBridgeProcess({
      command: 'sh',
      args: ['-c', script],
      cwd: dir,
      timeoutMs: 5_000,
    });

    await waitFor(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim().length > 0, 2_000);
    const grandchildPid = Number(readFileSync(pidFile, 'utf8').trim());
    expect(isAlive(grandchildPid)).toBe(true);

    bridge.terminate();

    await waitFor(() => !isAlive(grandchildPid), 2_000);
    expect(isAlive(grandchildPid)).toBe(false);
  });
});
