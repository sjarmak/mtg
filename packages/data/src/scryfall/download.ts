/**
 * Streaming download of a bulk file into the local cache.
 *
 * Written to a `.part` sibling and renamed only after the byte count checks
 * out, so a killed download can never leave a truncated file that later looks
 * like a valid cache hit. The cache directory is gitignored (`data/cache/`);
 * nothing here is ever committed.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DownloadIntegrityError } from '../errors';
import type { HttpClient } from '../http/client';
import { cacheFileName, type BulkDescriptor } from './catalog';

export interface DownloadProgress {
  readonly kind: string;
  readonly bytesDownloaded: number;
  readonly bytesExpected: number | null;
}

export interface DownloadOptions {
  readonly cacheDir: string;
  readonly onProgress?: (progress: DownloadProgress) => void;
  readonly signal?: AbortSignal;
}

export interface DownloadResult {
  readonly path: string;
  readonly bytes: number;
  /** True when a complete cached copy was already present and reused. */
  readonly cached: boolean;
}

async function fileSize(path: string): Promise<number | null> {
  try {
    const stats = await stat(path);
    return stats.isFile() ? stats.size : null;
  } catch {
    return null;
  }
}

export async function downloadBulkFile(
  client: HttpClient,
  descriptor: BulkDescriptor,
  options: DownloadOptions,
): Promise<DownloadResult> {
  const target = join(options.cacheDir, cacheFileName(descriptor));
  await mkdir(dirname(target), { recursive: true });

  const existing = await fileSize(target);
  if (existing !== null && (descriptor.compressedSize === null || existing === descriptor.compressedSize)) {
    return { path: target, bytes: existing, cached: true };
  }

  const partial = `${target}.part`;
  await rm(partial, { force: true });

  const { body, contentLength } = await client.getStream(descriptor.downloadUri);
  const expected = descriptor.compressedSize ?? contentLength;
  let bytes = 0;

  const source = Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);
  source.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    options.onProgress?.({ kind: descriptor.kind, bytesDownloaded: bytes, bytesExpected: expected });
  });

  try {
    const pipeOptions = options.signal === undefined ? {} : { signal: options.signal };
    await pipeline(source, createWriteStream(partial), pipeOptions);
  } catch (cause) {
    await rm(partial, { force: true });
    throw cause;
  }

  if (expected !== null && bytes !== expected) {
    await rm(partial, { force: true });
    throw new DownloadIntegrityError(descriptor.downloadUri, expected, bytes);
  }

  await rename(partial, target);
  return { path: target, bytes, cached: false };
}
