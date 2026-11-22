import { expect, it } from 'vitest';
import { runProbeProcess } from '../../tools/printed-probe-process';

it('collects stdout and stderr from a successful child', async () => {
  expect(
    await runProbeProcess(process.execPath, ['-e', 'console.log("out"); console.error("err");'], {
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 2000,
    }),
  ).toMatchObject({ code: 0, stdout: 'out\n', stderr: 'err\n', error: null });
});
it('kills descendants holding the output pipes when the deadline expires', async () => {
  const result = await runProbeProcess(
    process.execPath,
    [
      '-e',
      `
    require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
    setInterval(() => {}, 1000);
  `,
    ],
    { cwd: process.cwd(), env: process.env, timeoutMs: 500 },
  );
  expect(result.error).toMatch(/exceeded/);
  expect(result.code).not.toBe(0);
});
it('reports nonzero exit and spawn errors without claiming success', async () => {
  expect(
    await runProbeProcess(process.execPath, ['-e', 'process.exit(7)'], {
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 2000,
    }),
  ).toMatchObject({ code: 7 });
  expect(
    (
      await runProbeProcess('/absent/probe-command', [], {
        cwd: process.cwd(),
        env: process.env,
        timeoutMs: 2000,
      })
    ).error,
  ).toMatch(/ENOENT/);
});
it('bounds output and kills a child that exceeds the limit', async () => {
  const result = await runProbeProcess(
    process.execPath,
    ['-e', 'process.stdout.write(Buffer.alloc(17 * 1024 * 1024, 120)); setInterval(() => {}, 1000);'],
    { cwd: process.cwd(), env: process.env, timeoutMs: 3000 },
  );
  expect(result.error).toMatch(/output exceeded/);
  expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(16 * 1024 * 1024);
});
