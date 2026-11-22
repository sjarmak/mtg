import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAdoptionRegressions } from '../src/legacy-cube-calibration/adoption-regressions';

const execute = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({
  spawn: execute,
  execFile: () => {
    throw new Error('execFile does not expose detached groups');
  },
}));
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

function child(code: number | null = 0, signal: string | null = null, error?: Error) {
  const process = Object.assign(new EventEmitter(), {
    pid: 987654,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  queueMicrotask(() => {
    process.stdout.end('actual output');
    process.stderr.end('actual diagnostic');
    if (error) process.emit('error', error);
    else process.emit('exit', code, signal);
    process.emit('close', code, signal);
  });
  return process;
}

async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'mtg-adoption-gates-'));
  roots.push(root);
  return join(root, 'gates');
}

it('runs fixed local gates and archives actual output without accepting a passed flag', async () => {
  vi.spyOn(process, 'kill').mockReturnValue(true);
  execute.mockImplementation(() => child());
  const out = await directory();
  const result = await runAdoptionRegressions(out);
  expect(result.passed).toBe(true);
  expect(result.checks.map((c) => c.name)).toEqual(['typecheck', 'lint', 'format', 'test', 'ui-build']);
  expect(execute.mock.calls.every((call) => call[2].shell === false && call[2].detached)).toBe(true);
  expect(await readFile(join(out, 'test.stdout.txt'), 'utf8')).toBe('actual output');
  expect(result.checks.every((c) => c.exitCode === 0 && /^[a-f0-9]{64}$/.test(c.stdoutSha256))).toBe(true);
  await expect(runAdoptionRegressions(out)).rejects.toMatchObject({ code: 'EEXIST' });
});

it('records command failures and signal termination as failed evidence', async () => {
  vi.spyOn(process, 'kill').mockReturnValue(true);
  execute.mockImplementationOnce(() => child(2));
  execute.mockImplementation(() => child(null, 'SIGTERM'));
  const result = await runAdoptionRegressions(await directory());
  expect(result.passed).toBe(false);
  expect(result.checks[0]).toMatchObject({ exitCode: 2 });
  expect(result.checks[1]).toMatchObject({ exitCode: null, signal: 'SIGTERM' });
  expect(result.checks.every((c) => !c.passed)).toBe(true);
});

it('cleans the detached command group when a wrapper exits', async () => {
  const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
  execute.mockImplementation(() => child());
  await runAdoptionRegressions(await directory());
  expect(kill).toHaveBeenCalledWith(-987654, 'SIGKILL');
  expect(kill).toHaveBeenCalledTimes(5);
});

it('ignores only an already-gone process group, not permission failures', async () => {
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
    throw Object.assign(new Error('gone'), { code: 'ESRCH' });
  });
  execute.mockImplementation(() => child());
  expect((await runAdoptionRegressions(await directory())).passed).toBe(true);
  kill.mockImplementation(() => {
    throw Object.assign(new Error('denied'), { code: 'EPERM' });
  });
  const result = await runAdoptionRegressions(await directory());
  expect(result.passed).toBe(false);
  expect(result.checks[0]?.error).toContain('cleanup failed');
});

it('records spawn errors rather than treating close as a successful gate', async () => {
  vi.spyOn(process, 'kill').mockReturnValue(true);
  execute.mockImplementation(() => child(null, null, new Error('spawn ENOENT')));
  const result = await runAdoptionRegressions(await directory());
  expect(result.passed).toBe(false);
  expect(result.checks[0]?.error).toContain('spawn ENOENT');
});

it('fails and stops the group on timeout even when the wrapper subsequently exits zero', async () => {
  const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
  const timer = vi.spyOn(globalThis, 'setTimeout');
  execute.mockImplementation(() => {
    const proc = Object.assign(new EventEmitter(), {
      pid: 987654,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    queueMicrotask(() => {
      const call = timer.mock.calls.at(-1)!;
      expect(call[1]).toBe(30 * 60 * 1000);
      call[0]();
      proc.emit('exit', 0, null);
      proc.emit('close', 0, null);
    });
    return proc;
  });
  const result = await runAdoptionRegressions(await directory());
  expect(result.passed).toBe(false);
  expect(result.checks.every((c) => c.error?.includes('timeout'))).toBe(true);
  expect(kill).toHaveBeenCalledWith(-987654, 'SIGKILL');
});

it('bounds the combined output and rejects overflow even with a zero exit code', async () => {
  vi.spyOn(process, 'kill').mockReturnValue(true);
  execute.mockImplementation(() => {
    const proc = Object.assign(new EventEmitter(), {
      pid: 987654,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    queueMicrotask(() => {
      proc.stdout.write(Buffer.alloc(32 * 1024 * 1024, 'a'));
      proc.stderr.write('one byte too many');
      proc.emit('exit', 0, null);
      proc.emit('close', 0, null);
    });
    return proc;
  });
  const out = await directory();
  const result = await runAdoptionRegressions(out);
  expect(result.passed).toBe(false);
  expect(result.checks.every((c) => c.error?.includes('output limit'))).toBe(true);
  expect((await readFile(join(out, 'test.stdout.txt'))).length).toBe(32 * 1024 * 1024);
  expect((await readFile(join(out, 'test.stderr.txt'))).length).toBe(0);
});
