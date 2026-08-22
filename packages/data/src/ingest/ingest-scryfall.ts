/**
 * Catalog lookup + download in front of the local ingest engine.
 *
 * Change detection is `bulk_data.updated_at`, exactly as Scryfall intends: the
 * catalog is one small request, and a file whose timestamp already completed
 * costs nothing further. Scryfall's own guidance is that gameplay data changes
 * rarely enough to refetch weekly or after set releases, so cheap no-op runs
 * are the common case.
 */
import { DEFAULT_CACHE_DIR, type BulkKind } from '../config';
import { createHttpClient, type HttpClient } from '../http/client';
import { fetchBulkCatalog, selectDescriptor, type BulkDescriptor } from '../scryfall/catalog';
import { downloadBulkFile, type DownloadOptions, type DownloadProgress } from '../scryfall/download';
import { getRun } from '../store/runs';
import type { DataStore } from '../store/store';
import { ingestBulkFile, type IngestFileOptions, type IngestResult } from './ingest-file';

export interface ScryfallIngestOptions extends IngestFileOptions {
  readonly kinds: readonly BulkKind[];
  readonly cacheDir?: string;
  readonly client?: HttpClient;
  readonly onDownloadProgress?: (progress: DownloadProgress) => void;
}

export interface ScryfallIngestOutcome extends IngestResult {
  readonly descriptor: BulkDescriptor;
  readonly cachePath: string | null;
  readonly downloadedBytes: number;
  readonly reusedCache: boolean;
}

export async function ingestFromScryfall(
  store: DataStore,
  options: ScryfallIngestOptions,
): Promise<ScryfallIngestOutcome[]> {
  const client = options.client ?? createHttpClient();
  const cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
  const entries = await fetchBulkCatalog(client);
  const outcomes: ScryfallIngestOutcome[] = [];

  for (const kind of options.kinds) {
    const descriptor = selectDescriptor(entries, kind);
    const previous = getRun(store, kind);
    const alreadyDone =
      options.force !== true &&
      previous !== null &&
      previous.status === 'complete' &&
      previous.bulkUpdatedAt === descriptor.updatedAt;

    if (alreadyDone) {
      outcomes.push({
        kind,
        descriptor,
        bulkUpdatedAt: descriptor.updatedAt,
        status: 'skipped',
        resumedFromLine: previous.linesDone,
        linesRead: 0,
        rowsWritten: previous.rowsWritten,
        rowsRejected: previous.rowsRejected,
        cachePath: previous.contentPath,
        downloadedBytes: 0,
        reusedCache: true,
      });
      continue;
    }

    const downloadOptions: DownloadOptions = {
      cacheDir,
      ...(options.onDownloadProgress === undefined ? {} : { onProgress: options.onDownloadProgress }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    };
    const download = await downloadBulkFile(client, descriptor, downloadOptions);
    const result = await ingestBulkFile(store, descriptor, download.path, options);

    outcomes.push({
      ...result,
      descriptor,
      cachePath: download.path,
      downloadedBytes: download.cached ? 0 : download.bytes,
      reusedCache: download.cached,
    });
  }

  return outcomes;
}
