/** Exact backend support refusals survive the Node-owned HTTP boundary. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ObservedBackend, SessionSpec } from '@mtg/engine';
import type { RunningBackendGateway } from '../src/backend-gateway';
import { serveBackendGateway } from '../src/backend-gateway';
import { BACKEND_GATEWAY_PROTOCOL } from '../src/gateway-envelope';

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    { name: 'North', controller: 'local', deck: { name: 'north', cards: [] } },
    { name: 'South', controller: 'engine', deck: { name: 'south', cards: [] } },
  ],
  seed: 'backend-gateway/content-unsupported',
  maximumTurns: null,
};

const REASONS = [
  'Black Lotus: unsupported mana choice',
  'Animate Dead: unsupported attachment transition',
] as const;

let running: RunningBackendGateway | null = null;

afterEach(async () => {
  if (running !== null) await running.close();
  running = null;
});

describe('a routed backend content refusal', () => {
  it('crosses real HTTP with every reason still structured and exact', async () => {
    const open = vi.fn<ObservedBackend['open']>();
    const backend: ObservedBackend = {
      id: 'forge',
      determinism: 'observed',
      capabilities: { undo: false, fork: false, perSeatProjection: true, engineSeats: true },
      supports: () => Promise.resolve(REASONS),
      open,
    };
    running = await serveBackendGateway({
      host: '127.0.0.1',
      port: 0,
      installed: [backend],
      routes: { generated: 'kernel', printed: { 'legacy-cube-2021-08': 'forge' } },
    });

    const response = await fetch(`http://127.0.0.1:${String(running.port)}/engine-api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protocol: BACKEND_GATEWAY_PROTOCOL, table: TABLE }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      protocol: BACKEND_GATEWAY_PROTOCOL,
      ok: false,
      error: {
        code: 'route-refused',
        message: 'content-unsupported: backend "forge" refused this match with 2 named reasons',
        sessionError: {
          kind: 'content-unsupported',
          backend: 'forge',
          reasons: REASONS,
          message: 'backend "forge" refused this match with 2 named reasons',
        },
      },
    });
    expect(open).not.toHaveBeenCalled();
  });
});
