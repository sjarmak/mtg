// @vitest-environment jsdom
/** A person sees the exact blockers instead of a count-only route refusal. */
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ObservedBackend, SessionSpec } from '@mtg/engine';
import { BackendGame } from '../../src/routes/play/BackendGame';
import { BROWSER_BACKEND_PROTOCOL, httpObservedBackend } from '../../src/net/backend-gateway';

afterEach(cleanup);

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    { name: 'North', controller: 'local', deck: { name: 'north', cards: [] } },
    { name: 'South', controller: 'engine', deck: { name: 'south', cards: [] } },
  ],
  seed: 'component/content-unsupported',
  maximumTurns: null,
};

const REASONS = [
  'Black Lotus: unsupported mana choice',
  'Animate Dead: unsupported attachment transition',
] as const;

function refusingBackend(): ObservedBackend {
  return httpObservedBackend({
    id: 'forge',
    fetch: () =>
      Promise.resolve(
        Response.json(
          {
            protocol: BROWSER_BACKEND_PROTOCOL,
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
          },
          { status: 422 },
        ),
      ),
  });
}

describe('BackendGame refused before open', () => {
  it('renders each exact unsupported family or card reason', async () => {
    render(createElement(BackendGame, { backend: refusingBackend(), table: TABLE }));

    const alert = await screen.findByRole('alert');
    const text = (alert as unknown as { readonly textContent: string }).textContent;
    expect(text).toContain('content-unsupported');
    for (const reason of REASONS) expect(text).toContain(reason);
  });
});
