import { spawn, execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const entry = new URL('../../tools/backend.ts', import.meta.url).pathname;

async function unusedPort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no TCP address');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

function ready(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      reject(new Error(`backend startup timed out: ${output}`));
    }, 10000);
    const fail = (cause: unknown): void => {
      clearTimeout(timer);
      reject(cause);
    };
    child.once('error', fail);
    child.once('exit', (code) => fail(new Error(`backend exited ${String(code)}: ${output}`)));
    child.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
      if (output.includes('Backend gateway:')) {
        clearTimeout(timer);
        resolve(output);
      }
    });
    child.stderr?.on('data', (data: Buffer) => {
      output += data.toString();
    });
  });
}

it('runs a real independent gateway, reports missing Forge, and releases its port on SIGTERM', async () => {
  const port = await unusedPort();
  const child = spawn(process.execPath, ['--import', 'tsx', entry, '--port', String(port)], {
    env: { ...process.env, FORGE_HOME: '/nonexistent-mtg-forge-test-install' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  try {
    expect(await ready(child)).toContain('not installed');
    const response = await fetch(`http://127.0.0.1:${String(port)}/engine-api/sessions`);
    expect(response.status).toBe(405);
    expect(response.headers.get('content-type')).toContain('application/json');
    child.kill('SIGTERM');
    expect(await exited).toEqual([0, null]);
    const server = createServer();
    server.listen(port, '127.0.0.1');
    await once(server, 'listening');
    await new Promise<void>((resolve) => server.close(() => resolve()));
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
  }
}, 15000);

it('rejects CLI invocation without a stable port before starting services', async () => {
  await expect(
    promisify(execFile)(process.execPath, ['--import', 'tsx', entry], { timeout: 10000 }),
  ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('usage: npm run backend') });
}, 15000);
