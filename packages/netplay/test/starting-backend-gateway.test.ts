import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunningBackendGateway } from '@mtg/netplay';
import { BACKEND_GATEWAY_PROTOCOL, serveBackendGateway, serveStartingBackendGateway } from '@mtg/netplay';

const ROUTES = {
  generated: 'kernel',
  printed: {},
} as const;

function slowAdmissionPass(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

const ASK_FROM_ANOTHER_PROCESS = `
  fetch(process.argv[1], { method: 'POST', signal: AbortSignal.timeout(4000) })
    .then(async (response) => ({ status: response.status, body: await response.json() }))
    .catch((cause) => ({ status: 0, body: String(cause && cause.name) }))
    .then((answer) => process.stdout.write(JSON.stringify(answer)));
`;

async function reply(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

let running: RunningBackendGateway | null = null;

afterEach(async () => {
  if (running !== null) await running.close();
  running = null;
});

describe('the starting backend gateway', () => {
  it('answers gateway-starting while an admission pass is pending, then normal answers once it swaps in', async () => {
    running = await serveStartingBackendGateway({ host: '127.0.0.1', port: 0 });
    const base = `http://127.0.0.1:${String(running.port)}`;
    const admission = slowAdmissionPass();

    const readiness = await fetch(`${base}/engine-api/readiness?format=legacy-cube-2021-08`);
    expect(readiness.status).toBe(200);
    expect(await reply(readiness)).toEqual({
      protocol: BACKEND_GATEWAY_PROTOCOL,
      ok: true,
      format: 'legacy-cube-2021-08',
      ready: false,
      starting: true,
    });

    const open = await fetch(`${base}/engine-api/sessions`, { method: 'POST' });
    expect(open.status).toBe(503);
    expect(await reply(open)).toMatchObject({
      protocol: BACKEND_GATEWAY_PROTOCOL,
      ok: false,
      error: { code: 'gateway-starting' },
    });

    await admission;
    await running.close();

    running = await serveBackendGateway({ host: '127.0.0.1', port: 0, installed: [], routes: ROUTES });
    const swapped = `http://127.0.0.1:${String(running.port)}`;

    const after = await fetch(`${swapped}/engine-api/readiness?format=legacy-cube-2021-08`);
    expect(after.status).toBe(200);
    expect(await reply(after)).toEqual({
      protocol: BACKEND_GATEWAY_PROTOCOL,
      ok: true,
      format: 'legacy-cube-2021-08',
      ready: false,
    });

    const notFound = await fetch(`${swapped}/unknown`);
    expect(notFound.status).toBe(404);
    expect(await reply(notFound)).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });

  it('rebinds the real gateway on the exact port the starting gateway resolved', async () => {
    running = await serveStartingBackendGateway({ host: '127.0.0.1', port: 0 });
    const boundPort = running.port;
    await running.close();

    running = await serveBackendGateway({
      host: '127.0.0.1',
      port: boundPort,
      installed: [],
      routes: ROUTES,
    });

    expect(running.port).toBe(boundPort);
  });

  it('answers while the thread that started it is blocked', async () => {
    running = await serveStartingBackendGateway({ host: '127.0.0.1', port: 0 });
    const sessions = `http://127.0.0.1:${String(running.port)}/engine-api/sessions`;

    const asked = execFileSync(process.execPath, ['-e', ASK_FROM_ANOTHER_PROCESS, sessions], {
      encoding: 'utf8',
      timeout: 20_000,
    });

    expect(JSON.parse(asked)).toMatchObject({
      status: 503,
      body: { protocol: BACKEND_GATEWAY_PROTOCOL, ok: false, error: { code: 'gateway-starting' } },
    });
  });

  it('refuses a port something else is listening on, naming the reason', async () => {
    running = await serveStartingBackendGateway({ host: '127.0.0.1', port: 0 });

    await expect(
      serveStartingBackendGateway({ host: '127.0.0.1', port: running.port }),
    ).rejects.toMatchObject({
      code: 'EADDRINUSE',
    });
  });

  it('frees its port on close, however often close is asked for', async () => {
    const starting = await serveStartingBackendGateway({ host: '127.0.0.1', port: 0 });
    await Promise.all([starting.close(), starting.close()]);

    running = await serveStartingBackendGateway({ host: '127.0.0.1', port: starting.port });

    expect(running.port).toBe(starting.port);
  });
});
