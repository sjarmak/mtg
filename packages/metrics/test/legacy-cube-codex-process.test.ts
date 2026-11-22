import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { runCodexProcess } from '../src/legacy-cube-calibration/codex-process';

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});
const command = {
  binary: '/verified/codex',
  args: ['exec'],
  cwd: '/empty',
  env: { PATH: '/bin' },
  input: 'prompt',
  timeoutMs: 50,
  outputLimit: 100,
};
function child() {
  return Object.assign(new EventEmitter(), {
    pid: 987654,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
}
it('pipes input without a shell and captures output with group cleanup', async () => {
  const process = child();
  const kill = vi.spyOn(globalThis.process, 'kill').mockReturnValue(true);
  spawn.mockImplementation(() => {
    queueMicrotask(() => {
      process.stdout.write('response');
      process.stderr.write('diagnostic');
      process.emit('exit', 0, null);
      process.emit('close', 0, null);
    });
    return process;
  });
  const result = await runCodexProcess(command);
  expect(result).toEqual({
    stdout: 'response',
    stderr: 'diagnostic',
    exitCode: 0,
    signal: null,
    error: null,
  });
  expect(process.stdin.read().toString()).toBe('prompt');
  expect(spawn).toHaveBeenCalledWith(
    '/verified/codex',
    ['exec'],
    expect.objectContaining({ shell: false, detached: true, env: { PATH: '/bin' } }),
  );
  expect(kill).toHaveBeenCalledWith(-987654, 'SIGKILL');
});
it.each(['timeout', 'overflow', 'stdin', 'spawn', 'cleanup'] as const)(
  'does not turn %s failure into success on a zero exit',
  async (failure) => {
    const process = child();
    const finish = () => {
      process.emit('exit', 0, null);
      process.emit('close', 0, null);
    };
    vi.spyOn(globalThis.process, 'kill').mockImplementation(() => {
      if (failure === 'cleanup') throw Object.assign(new Error('denied'), { code: 'EPERM' });
      if (failure === 'timeout') queueMicrotask(finish);
      return true;
    });
    spawn.mockImplementation(() => {
      queueMicrotask(() => {
        if (failure === 'timeout') return;
        if (failure === 'overflow') process.stdout.write('x'.repeat(101));
        if (failure === 'stdin') process.stdin.emit('error', new Error('broken input'));
        if (failure === 'spawn') process.emit('error', new Error('cannot spawn'));
        finish();
      });
      return process;
    });
    const result = await runCodexProcess(command);
    expect(result.error).not.toBeNull();
    expect(result.stdout.length).toBeLessThanOrEqual(100);
  },
);
