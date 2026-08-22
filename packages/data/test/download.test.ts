import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DownloadIntegrityError,
  closeStore,
  createHttpClient,
  createLimiter,
  downloadBulkFile,
  ingestFromScryfall,
  storeStats,
} from '@mtg/data';
import { FIXTURES, ORACLE_UPDATED_AT, VALID_FIXTURE_CARDS, descriptorFor, memoryStore } from './helpers';

const noSleep = (): Promise<void> => Promise.resolve();

function gzippedFixture(path: string): Buffer {
  return gzipSync(readFileSync(path));
}

/** Serves the bulk catalog from `api.scryfall.com` and files from the CDN host. */
function labFetch(payloads: Readonly<Record<string, Buffer | string>>, log: string[]): typeof fetch {
  return ((url: string) => {
    log.push(url);
    const payload = payloads[url];
    if (payload === undefined) return Promise.resolve(new Response('not found', { status: 404 }));
    const body = typeof payload === 'string' ? payload : new Uint8Array(payload);
    return Promise.resolve(
      new Response(body, {
        status: 200,
        headers: { 'content-length': String(typeof payload === 'string' ? payload.length : payload.length) },
      }),
    );
  }) as unknown as typeof fetch;
}

describe('bulk download', () => {
  const temporaryDirs: string[] = [];

  afterEach(() => {
    for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function scratch(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    temporaryDirs.push(dir);
    return dir;
  }

  it('streams a bulk file into the cache and reuses it on the next call', async () => {
    const cacheDir = scratch('mtg-data-dl-');
    const gz = gzippedFixture(FIXTURES.oracleCards);
    const descriptor = { ...descriptorFor('oracle_cards', ORACLE_UPDATED_AT), compressedSize: gz.length };
    const log: string[] = [];
    const client = createHttpClient({
      fetchImpl: labFetch({ [descriptor.downloadUri]: gz }, log),
      sleep: noSleep,
      limiter: createLimiter(noSleep),
    });

    const first = await downloadBulkFile(client, descriptor, { cacheDir });
    expect(first.cached).toBe(false);
    expect(first.bytes).toBe(gz.length);
    expect(first.path).toBe(join(cacheDir, 'oracle_cards-20260809090238.jsonl.gz'));
    expect(existsSync(first.path)).toBe(true);
    expect(readdirSync(cacheDir).filter((name) => name.endsWith('.part'))).toEqual([]);

    const second = await downloadBulkFile(client, descriptor, { cacheDir });
    expect(second.cached).toBe(true);
    expect(log).toHaveLength(1);
  });

  it('refuses a truncated download and leaves no cache file behind', async () => {
    const cacheDir = scratch('mtg-data-trunc-');
    const gz = gzippedFixture(FIXTURES.oracleCards);
    const descriptor = {
      ...descriptorFor('oracle_cards', ORACLE_UPDATED_AT),
      compressedSize: gz.length + 100,
    };
    const client = createHttpClient({
      fetchImpl: labFetch({ [descriptor.downloadUri]: gz }, []),
      sleep: noSleep,
      limiter: createLimiter(noSleep),
    });

    await expect(downloadBulkFile(client, descriptor, { cacheDir })).rejects.toThrow(DownloadIntegrityError);
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  it('reports progress while streaming', async () => {
    const cacheDir = scratch('mtg-data-prog-');
    const gz = gzippedFixture(FIXTURES.oracleCards);
    const descriptor = { ...descriptorFor('oracle_cards', ORACLE_UPDATED_AT), compressedSize: gz.length };
    const client = createHttpClient({
      fetchImpl: labFetch({ [descriptor.downloadUri]: gz }, []),
      sleep: noSleep,
      limiter: createLimiter(noSleep),
    });

    const seen: number[] = [];
    await downloadBulkFile(client, descriptor, {
      cacheDir,
      onProgress: (progress) => seen.push(progress.bytesDownloaded),
    });

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe(gz.length);
  });
});

describe('end-to-end ingest against a stubbed Scryfall', () => {
  const temporaryDirs: string[] = [];

  afterEach(() => {
    for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('walks catalog → download → stream → store, then no-ops on the second run', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'mtg-data-e2e-'));
    temporaryDirs.push(cacheDir);

    const catalog = JSON.stringify({
      object: 'list',
      has_more: false,
      data: [
        {
          object: 'bulk_data',
          id: '27bf3214-1271-490b-bdfe-c0be6c23d02e',
          type: 'oracle_cards',
          updated_at: ORACLE_UPDATED_AT,
          uri: 'https://api.scryfall.com/bulk-data/27bf3214-1271-490b-bdfe-c0be6c23d02e',
          name: 'Oracle Cards',
          description: 'One card object per Oracle ID.',
          jsonl_download_uri: 'https://data.scryfall.io/oracle-cards/oracle-cards-20260809090238.jsonl.gz',
        },
      ],
    });
    const gz = gzippedFixture(FIXTURES.oracleCards);
    const log: string[] = [];
    const client = createHttpClient({
      fetchImpl: labFetch(
        {
          'https://api.scryfall.com/bulk-data': catalog,
          'https://data.scryfall.io/oracle-cards/oracle-cards-20260809090238.jsonl.gz': gz,
        },
        log,
      ),
      sleep: noSleep,
      limiter: createLimiter(noSleep),
    });

    const store = memoryStore();
    const first = await ingestFromScryfall(store, { kinds: ['oracle_cards'], cacheDir, client });

    expect(first).toHaveLength(1);
    expect(first[0]?.status).toBe('complete');
    expect(first[0]?.rowsWritten).toBe(VALID_FIXTURE_CARDS);
    expect(first[0]?.reusedCache).toBe(false);
    expect(storeStats(store).oracleCards).toBe(VALID_FIXTURE_CARDS);

    const second = await ingestFromScryfall(store, { kinds: ['oracle_cards'], cacheDir, client });
    expect(second[0]?.status).toBe('skipped');
    expect(second[0]?.downloadedBytes).toBe(0);
    // Second run costs one catalog request and no file transfer.
    expect(log.filter((url) => url.includes('data.scryfall.io'))).toHaveLength(1);

    closeStore(store);
  });
});
