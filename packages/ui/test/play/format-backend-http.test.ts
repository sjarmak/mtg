/** Real gateway transport with deterministic fixture engines, not Forge compatibility evidence. */
import { expect, it, vi } from 'vitest';
import { scriptBackend } from '@mtg/engine';
import { BACKEND_GATEWAY_PROTOCOL, serveBackendGateway } from '@mtg/netplay';
import { formatObservedBackend } from '../../tools/format-observed-backend';

it('keeps two printed-format sessions on their original owners through interleaved HTTP moves', async () => {
  const legacy = scriptBackend({ clock: 1 });
  const akh = scriptBackend({ clock: 2 });
  const legacyOpen = vi.fn(legacy.open);
  const akhOpen = vi.fn(akh.open);
  const legacyShutdown = vi.fn(async () => undefined);
  const akhShutdown = vi.fn(async () => undefined);
  const dispatch = formatObservedBackend([
    {
      format: 'legacy-cube-2021-08',
      backend: { ...legacy, supports: async () => [], open: legacyOpen, shutdown: legacyShutdown },
    },
    {
      format: 'akh-hou',
      backend: { ...akh, supports: async () => [], open: akhOpen, shutdown: akhShutdown },
    },
  ]);
  const gateway = await serveBackendGateway({
    host: '127.0.0.1',
    port: 0,
    installed: [dispatch],
    routes: { generated: 'kernel', printed: { 'legacy-cube-2021-08': dispatch.id, 'akh-hou': dispatch.id } },
  });
  const send = async (path: string, body: unknown) => {
    const response = await fetch(`http://127.0.0.1:${gateway.port}/engine-api/sessions${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protocol: BACKEND_GATEWAY_PROTOCOL, ...(body as object) }),
    });
    expect(response.status).toBe(200);
    return (await response.json()) as Record<string, unknown>;
  };
  try {
    const tokens: string[] = [];
    for (const format of ['legacy-cube-2021-08', 'akh-hou']) {
      const opened = await send('', {
        table: {
          content: { kind: 'printed', format },
          seats: [
            { name: 'You', controller: 'local', deck: { name: 'You', cards: [] } },
            { name: 'Bot', controller: 'engine', deck: { name: 'Bot', cards: [] } },
          ],
          seed: 'format-http/v1',
          maximumTurns: null,
        },
      });
      expect(opened['ok']).toBe(true);
      expect(typeof opened['token']).toBe('string');
      tokens.push(opened['token'] as string);
    }
    expect(tokens[0]).not.toBe(tokens[1]);
    const first = await send(`/${tokens[0]}`, { revision: 0, move: 'advance' });
    const second = await send(`/${tokens[1]}`, { revision: 0, move: 'advance' });
    expect(first).toMatchObject({
      ok: true,
      revision: 1,
      session: { status: 'finished', backend: dispatch.id },
    });
    expect(second).toMatchObject({
      ok: true,
      revision: 1,
      session: { status: 'awaiting', backend: dispatch.id },
    });
    expect(await send(`/${tokens[1]}`, { revision: 1, move: 'advance' })).toMatchObject({
      ok: true,
      revision: 2,
      session: { status: 'finished', backend: dispatch.id },
    });
    expect(legacyOpen).toHaveBeenCalledTimes(1);
    expect(akhOpen).toHaveBeenCalledTimes(1);
  } finally {
    await gateway.close();
  }
  expect(legacyShutdown).toHaveBeenCalledTimes(1);
  expect(akhShutdown).toHaveBeenCalledTimes(1);
});
