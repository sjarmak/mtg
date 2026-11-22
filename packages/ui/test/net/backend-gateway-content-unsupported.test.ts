/** The browser adapter treats gateway bytes as hostile while preserving valid support reasons. */
import { describe, expect, it } from 'vitest';
import type { SessionSpec } from '@mtg/engine';
import { BROWSER_BACKEND_PROTOCOL, httpObservedBackend } from '../../src/net/backend-gateway';

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    { name: 'North', controller: 'local', deck: { name: 'north', cards: [] } },
    { name: 'South', controller: 'engine', deck: { name: 'south', cards: [] } },
  ],
  seed: 'browser/content-unsupported',
  maximumTurns: null,
};

const REASONS = ['Black Lotus: unsupported mana choice', 'Animate Dead: unsupported attachment transition'];

function refusal(reasons: unknown): Response {
  return Response.json(
    {
      protocol: BROWSER_BACKEND_PROTOCOL,
      ok: false,
      error: {
        code: 'route-refused',
        message: 'content-unsupported: backend "forge" refused this match with 2 named reasons',
        sessionError: {
          kind: 'content-unsupported',
          backend: 'forge',
          reasons,
          message: 'backend "forge" refused this match with 2 named reasons',
        },
      },
    },
    { status: 422 },
  );
}

describe('the browser-safe content refusal reader', () => {
  it('returns every exact reason through the neutral backend result channel', async () => {
    const backend = httpObservedBackend({ id: 'forge', fetch: () => Promise.resolve(refusal(REASONS)) });

    expect(await backend.open(TABLE)).toEqual({
      ok: false,
      error: {
        kind: 'content-unsupported',
        backend: 'forge',
        reasons: REASONS,
        message: 'backend "forge" refused this match with 2 named reasons',
      },
    });
  });

  it('does not admit a malformed reasons array as a typed session error', async () => {
    const backend = httpObservedBackend({
      id: 'forge',
      fetch: () => Promise.resolve(refusal([REASONS[0], { html: '<img onerror=steal()>' }])),
    });

    expect(await backend.open(TABLE)).toEqual({
      ok: false,
      error: {
        kind: 'backend-failure',
        message:
          'route-refused: content-unsupported: backend "forge" refused this match with 2 named reasons',
      },
    });
  });
});
