import { describe, expect, it } from 'vitest';
import type { GameBackend, ObservedBackend, SessionSpec } from '@mtg/engine';
import { routeBackend, scriptBackend } from '@mtg/engine';

const GENERATED: SessionSpec = {
  content: { kind: 'dsl-set', setCode: 'TST' },
  seats: [
    { name: 'North', controller: 'local', deck: { name: 'north', cards: [] } },
    { name: 'South', controller: 'engine', deck: { name: 'south', cards: [] } },
  ],
  seed: 'backend-selection',
  maximumTurns: null,
};

const PRINTED: SessionSpec = {
  ...GENERATED,
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
};

const MIXED: SessionSpec = {
  ...GENERATED,
  content: {
    kind: 'mixed',
    format: 'legacy-cube-2021-08',
    customSetCodes: ['CSTM'],
  },
};

const ROUTES = {
  generated: 'kernel',
  printed: { 'legacy-cube-2021-08': 'forge' },
} as const;

function backend(id: string, supports: (table: SessionSpec) => Promise<readonly string[]>): ObservedBackend {
  return { ...scriptBackend(), id, supports };
}

describe('whole-match backend routing', () => {
  it('routes generated content to the declared generated backend', async () => {
    const kernel = backend('kernel', async () => []);
    const forge = backend('forge', async () => []);

    const selected = await routeBackend(GENERATED, [forge, kernel], ROUTES);

    expect(selected).toEqual({ ok: true, backend: kernel });
  });

  it('routes a printed format to its explicitly declared backend', async () => {
    const kernel = backend('kernel', async () => []);
    const forge = backend('forge', async () => []);

    const selected = await routeBackend(PRINTED, [kernel, forge], ROUTES);

    expect(selected).toEqual({ ok: true, backend: forge });
  });

  it('routes mixed printed and custom content through the printed format route', async () => {
    const kernel = backend('kernel', async () => []);
    const forge = backend('forge', async () => []);

    const selected = await routeBackend(MIXED, [kernel, forge], ROUTES);

    expect(selected).toEqual({ ok: true, backend: forge });
  });

  it('returns every named refusal from the selected backend', async () => {
    const forge = backend('forge', async () => [
      'custom card "First" rejects UNMAPPED_EFFECT_KIND at effects[0]',
      'custom card "Second" rejects UNMAPPED_TRIGGER_KIND at abilities[0]',
    ]);

    const selected = await routeBackend(PRINTED, [forge], ROUTES);

    expect(selected).toEqual({
      ok: false,
      error: {
        kind: 'content-unsupported',
        backend: 'forge',
        reasons: [
          'custom card "First" rejects UNMAPPED_EFFECT_KIND at effects[0]',
          'custom card "Second" rejects UNMAPPED_TRIGGER_KIND at abilities[0]',
        ],
        message: 'backend "forge" refused this match with 2 named reasons',
      },
    });
  });

  it('does not fall through when the routed backend refuses the match', async () => {
    let fallbackAsked = false;
    const forge = backend('forge', async () => ['custom card "First" does not transpile']);
    const temptingFallback = backend('other', async () => {
      fallbackAsked = true;
      return [];
    });

    const selected = await routeBackend(PRINTED, [forge, temptingFallback], ROUTES);

    expect(selected.ok).toBe(false);
    expect(fallbackAsked).toBe(false);
  });

  it('fails explicitly when the route names no installed backend', async () => {
    const selected = await routeBackend(PRINTED, [], ROUTES);

    expect(selected).toEqual({
      ok: false,
      error: {
        kind: 'backend-missing',
        backend: 'forge',
        message: 'route selected backend "forge", but it is not installed',
      },
    });
  });

  it('rejects duplicate backend identities rather than choosing by array order', async () => {
    const first = backend('forge', async () => []);
    const second = backend('forge', async () => []);

    const selected = await routeBackend(PRINTED, [first, second], ROUTES);

    expect(selected).toEqual({
      ok: false,
      error: {
        kind: 'duplicate-backend',
        backend: 'forge',
        message: 'backend id "forge" is installed more than once',
      },
    });
  });

  it('rejects an ambiguous installed registry even when this route names another backend', async () => {
    const kernel = backend('kernel', async () => []);
    const first = backend('other', async () => []);
    const second = backend('other', async () => []);

    const selected = await routeBackend(GENERATED, [kernel, first, second], ROUTES);

    expect(selected).toEqual({
      ok: false,
      error: {
        kind: 'duplicate-backend',
        backend: 'other',
        message: 'backend id "other" is installed more than once',
      },
    });
  });

  it('reports an unconfigured printed format without consulting a backend', async () => {
    let asked = false;
    const forge = backend('forge', async () => {
      asked = true;
      return [];
    });
    const table: SessionSpec = {
      ...PRINTED,
      content: { kind: 'printed', format: 'some-other-cube' },
    };

    const selected = await routeBackend(table, [forge], ROUTES);

    expect(selected).toEqual({
      ok: false,
      error: {
        kind: 'route-missing',
        content: 'printed:some-other-cube',
        message: 'no backend route is configured for printed format "some-other-cube"',
      },
    });
    expect(asked).toBe(false);
  });

  it('names mixed content distinctly when its printed format has no route', async () => {
    let asked = false;
    const forge = backend('forge', async () => {
      asked = true;
      return [];
    });
    const table: SessionSpec = {
      ...MIXED,
      content: {
        kind: 'mixed',
        format: 'some-other-cube',
        customSetCodes: ['CSTM'],
      },
    };

    const selected = await routeBackend(table, [forge], ROUTES);

    expect(selected).toEqual({
      ok: false,
      error: {
        kind: 'route-missing',
        content: 'mixed:some-other-cube',
        message: 'no backend route is configured for mixed format "some-other-cube"',
      },
    });
    expect(asked).toBe(false);
  });

  it('turns a support-probe exception into a named boundary failure', async () => {
    const forge = backend('forge', async () => {
      throw new Error('bridge inventory process died');
    });

    const selected = await routeBackend(PRINTED, [forge], ROUTES);

    expect(selected).toEqual({
      ok: false,
      error: {
        kind: 'support-check-failed',
        backend: 'forge',
        message: 'backend "forge" support check failed: bridge inventory process died',
      },
    });
  });

  it('returns the exact installed backend object that will own open and submit', async () => {
    const forge: GameBackend = backend('forge', async () => []);

    const selected = await routeBackend(PRINTED, [forge], ROUTES);

    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(selected.backend).toBe(forge);
  });
});
