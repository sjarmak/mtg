import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ACCEPT_HEADER,
  BulkCatalogSchema,
  HttpError,
  RemoteShapeError,
  SCRYFALL_BULK_ENDPOINT,
  USER_AGENT,
  cacheFileName,
  createHttpClient,
  createLimiter,
  fetchBulkCatalog,
  minIntervalFor,
  selectDescriptor,
  toDescriptor,
} from '@mtg/data';
import { FIXTURES, readFixtureJson } from './helpers';

interface RecordedRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
}

function stubFetch(
  responses: ReadonlyArray<{ status: number; body: string; headers?: Record<string, string> }>,
  log: RecordedRequest[],
): typeof fetch {
  let index = 0;
  return ((url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    log.push({ url, headers });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (response === undefined) throw new Error('stub exhausted');
    return Promise.resolve(
      new Response(response.body, { status: response.status, headers: response.headers ?? {} }),
    );
  }) as unknown as typeof fetch;
}

const noSleep = (): Promise<void> => Promise.resolve();

describe('http client', () => {
  it('sends the pinned User-Agent and Accept headers on every request', async () => {
    const log: RecordedRequest[] = [];
    const client = createHttpClient({
      fetchImpl: stubFetch([{ status: 200, body: '{"ok":true}' }], log),
      sleep: noSleep,
      limiter: createLimiter(noSleep),
    });

    await client.getJson('https://api.scryfall.com/bulk-data', z.object({ ok: z.boolean() }));

    expect(log).toHaveLength(1);
    expect(log[0]?.headers['User-Agent']).toBe(USER_AGENT);
    expect(log[0]?.headers['Accept']).toBe(ACCEPT_HEADER);
    expect(USER_AGENT).toMatch(/mtg-lab/);
  });

  it('backs off and retries a 429 rather than hammering the endpoint', async () => {
    const log: RecordedRequest[] = [];
    const waits: number[] = [];
    const client = createHttpClient({
      fetchImpl: stubFetch(
        [
          { status: 429, body: 'slow down', headers: { 'retry-after': '2' } },
          { status: 200, body: '{"ok":true}' },
        ],
        log,
      ),
      sleep: async (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
      limiter: createLimiter(noSleep),
    });

    const result = await client.getJson('https://api.scryfall.com/bulk-data', z.object({ ok: z.boolean() }));
    expect(result.ok).toBe(true);
    expect(log).toHaveLength(2);
    expect(waits).toEqual([2_000]);
  });

  it('gives up on a non-retryable status with a typed error', async () => {
    const log: RecordedRequest[] = [];
    const client = createHttpClient({
      fetchImpl: stubFetch([{ status: 404, body: 'nope' }], log),
      sleep: noSleep,
      limiter: createLimiter(noSleep),
    });

    await expect(client.getJson('https://api.scryfall.com/bulk-data', z.object({}))).rejects.toThrow(
      HttpError,
    );
    expect(log).toHaveLength(1);
  });

  it('stops retrying after the configured budget', async () => {
    const log: RecordedRequest[] = [];
    const client = createHttpClient({
      maxRetries: 2,
      fetchImpl: stubFetch([{ status: 503, body: 'down' }], log),
      sleep: noSleep,
      limiter: createLimiter(noSleep),
    });

    await expect(client.getJson('https://api.scryfall.com/bulk-data', z.object({}))).rejects.toThrow(
      HttpError,
    );
    expect(log).toHaveLength(3);
  });

  it('rejects a response whose shape does not match the schema', async () => {
    const log: RecordedRequest[] = [];
    const client = createHttpClient({
      fetchImpl: stubFetch([{ status: 200, body: '{"object":"not-a-list"}' }], log),
      sleep: noSleep,
      limiter: createLimiter(noSleep),
    });

    await expect(fetchBulkCatalog(client)).rejects.toThrow(RemoteShapeError);
  });

  it('rejects a response that is not JSON at all', async () => {
    const log: RecordedRequest[] = [];
    const client = createHttpClient({
      fetchImpl: stubFetch([{ status: 200, body: '<html>maintenance</html>' }], log),
      sleep: noSleep,
      limiter: createLimiter(noSleep),
    });

    await expect(fetchBulkCatalog(client)).rejects.toThrow(RemoteShapeError);
  });
});

describe('rate limiter', () => {
  it('spaces requests to a host by the documented minimum interval', async () => {
    let clock = 0;
    const slept: number[] = [];
    const limiter = createLimiter(
      async (ms) => {
        slept.push(ms);
        clock += ms;
        return Promise.resolve();
      },
      () => clock,
    );

    await limiter.acquire('api.scryfall.com');
    await limiter.acquire('api.scryfall.com');
    await limiter.acquire('api.scryfall.com');

    expect(minIntervalFor('api.scryfall.com')).toBe(100);
    expect(slept).toEqual([100, 100]);
  });

  it('keeps separate budgets per host', async () => {
    let clock = 0;
    const slept: number[] = [];
    const limiter = createLimiter(
      async (ms) => {
        slept.push(ms);
        clock += ms;
        return Promise.resolve();
      },
      () => clock,
    );

    await limiter.acquire('api.scryfall.com');
    await limiter.acquire('mtgjson.com');
    expect(slept).toEqual([]);
  });

  it('applies a 429 penalty to subsequent acquisitions', async () => {
    let clock = 0;
    const slept: number[] = [];
    const limiter = createLimiter(
      async (ms) => {
        slept.push(ms);
        clock += ms;
        return Promise.resolve();
      },
      () => clock,
    );

    await limiter.acquire('api.scryfall.com');
    limiter.penalize('api.scryfall.com', 30_000);
    await limiter.acquire('api.scryfall.com');

    expect(slept).toEqual([30_000]);
  });
});

describe('bulk catalog', () => {
  it('parses the real catalog response and selects the kinds we ingest', () => {
    const catalog = BulkCatalogSchema.parse(readFixtureJson(FIXTURES.bulkCatalog));
    expect(catalog.data.length).toBe(7);

    const oracle = selectDescriptor(catalog.data, 'oracle_cards');
    expect(oracle.downloadUri).toMatch(/^https:\/\/data\.scryfall\.io\/oracle-cards\//);
    expect(oracle.downloadUri).toMatch(/\.jsonl\.gz$/);
    expect(oracle.updatedAt).toBe('2026-08-09T09:02:38.172+00:00');
    expect(oracle.compressedSize).toBeGreaterThan(1_000_000);

    const rulings = selectDescriptor(catalog.data, 'rulings');
    expect(rulings.kind).toBe('rulings');
    expect(rulings.description).toContain('Rulings');
  });

  it('fails loudly when a requested bulk kind is absent', () => {
    const catalog = BulkCatalogSchema.parse(readFixtureJson(FIXTURES.bulkCatalog));
    const withoutRulings = catalog.data.filter((entry) => entry.type !== 'rulings');
    expect(() => selectDescriptor(withoutRulings, 'rulings')).toThrow(RemoteShapeError);
  });

  it('derives a cache filename that changes with the upstream timestamp', () => {
    const catalog = BulkCatalogSchema.parse(readFixtureJson(FIXTURES.bulkCatalog));
    const entry = catalog.data.find((candidate) => candidate.type === 'oracle_cards');
    expect(entry).toBeDefined();

    const descriptor = toDescriptor(entry!, 'oracle_cards');
    expect(cacheFileName(descriptor)).toBe('oracle_cards-20260809090238.jsonl.gz');

    const rebuilt = { ...descriptor, updatedAt: '2026-08-10T09:02:38.172+00:00' };
    expect(cacheFileName(rebuilt)).not.toBe(cacheFileName(descriptor));
  });

  it('points at the documented endpoint', () => {
    expect(SCRYFALL_BULK_ENDPOINT).toBe('https://api.scryfall.com/bulk-data');
  });
});
