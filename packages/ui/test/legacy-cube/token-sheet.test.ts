/**
 * The cube's token sheet reaches the board: the app shell reads it beside the
 * catalog, refuses to open the cube when a named sheet cannot be read, and
 * the route hands the sheet to the game with the catalog.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLegacyCube } from '../../src/dev/LabApp';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', '..', '..', 'data', 'data');
const catalog: unknown = JSON.parse(
  readFileSync(join(DATA, 'legacy-cube-2021-card-catalog-v1.json'), 'utf8'),
);
const sheet: unknown = JSON.parse(
  readFileSync(join(DATA, 'legacy-cube-2021-token-printings-v1.json'), 'utf8'),
);

function json(body: unknown) {
  return Promise.resolve({
    ok: true,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loading the Legacy Cube with its token sheet', () => {
  it('reads the sheet beside the catalog', async () => {
    vi.stubGlobal('fetch', (url: string) => (url === 'cube.json' ? json(catalog) : json(sheet)));
    const state = await loadLegacyCube('cube.json', 'tokens.json');
    expect(state.status).toBe('ready');
    if (state.status !== 'ready') throw new Error('unreachable');
    expect(state.tokens?.some((token) => token.name === 'Elephant')).toBe(true);
  });

  it('opens without tokens only when no sheet is named', async () => {
    vi.stubGlobal('fetch', () => json(catalog));
    const state = await loadLegacyCube('cube.json', undefined);
    expect(state).toMatchObject({ status: 'ready' });
    expect(state.status === 'ready' && state.tokens).toBeUndefined();
  });

  it('fails the cube when the named sheet is not staged or is malformed', async () => {
    vi.stubGlobal('fetch', (url: string) =>
      url === 'cube.json'
        ? json(catalog)
        : Promise.resolve({ ok: false, status: 404, headers: { get: () => 'application/json' } }),
    );
    await expect(loadLegacyCube('cube.json', 'tokens.json')).resolves.toEqual({
      status: 'failed',
      message: 'tokens.json could not be read: the token sheet is not staged',
    });

    vi.stubGlobal('fetch', (url: string) => (url === 'cube.json' ? json(catalog) : json({ tokens: [] })));
    const malformed = await loadLegacyCube('cube.json', 'tokens.json');
    expect(malformed.status).toBe('failed');
  });
});

describe('the Legacy Cube route', () => {
  it('hands the token sheet to the game beside the catalog', () => {
    const source = readFileSync(
      join(HERE, '..', '..', 'src', 'routes', 'legacy-cube', 'LegacyCubeRoute.ts'),
      'utf8',
    );
    expect(source).toContain('printedCards: [...props.pool.catalog.cards, ...props.tokens]');
    const shell = readFileSync(join(HERE, '..', '..', 'src', 'main.ts'), 'utf8');
    expect(shell).toContain("legacyCubeTokensUrl: 'legacy-cube-2021-token-printings-v1.json'");
  });
});
