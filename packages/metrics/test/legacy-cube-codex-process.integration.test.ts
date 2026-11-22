/** Real subprocess checks; no model, network, or account access. */
import { expect, it } from 'vitest';
import { runCodexProcess } from '../src/legacy-cube-calibration/codex-process';

const run = (script: string, input = '', timeoutMs = 2000, outputLimit = 1024) =>
  runCodexProcess({
    binary: process.execPath,
    args: ['-e', script],
    cwd: process.cwd(),
    env: {},
    input,
    timeoutMs,
    outputLimit,
  });

it('round-trips input through a real isolated child', async () => {
  const result = await run('process.stdin.pipe(process.stdout)', 'canonical task');
  expect(result).toEqual({ stdout: 'canonical task', stderr: '', exitCode: 0, signal: null, error: null });
});

it('preserves a real nonzero exit and diagnostics', async () => {
  const result = await run("process.stderr.write('refused'); process.exitCode = 3");
  expect(result).toMatchObject({ stderr: 'refused', exitCode: 3 });
});

it('terminates a real stalled process on timeout', async () => {
  const result = await run('setInterval(() => {}, 1000)', '', 100);
  expect(result.error).toMatch(/timeout/);
  expect(result.signal).toBe('SIGKILL');
});

it('bounds real excessive output and reports failure', async () => {
  const result = await run("process.stdout.write('x'.repeat(10000))", '', 2000, 100);
  expect(result.stdout).toHaveLength(100);
  expect(result.error).toMatch(/output limit/);
});

it('captures a missing executable as a process failure', async () => {
  const result = await runCodexProcess({
    binary: '/nonexistent/mtg-codex-executable',
    args: [],
    cwd: process.cwd(),
    env: {},
    input: '',
    timeoutMs: 1000,
    outputLimit: 100,
  });
  expect(result.error).toMatch(/spawn failed/);
  expect(result.exitCode).not.toBe(0);
});
