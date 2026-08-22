/**
 * The Scryfall bulk-data catalog: what files exist, when they were last built,
 * and where to stream them from.
 *
 * Note the field is `jsonl_download_uri`, not the older `download_uri` that
 * served a single giant JSON array — bulk files are gzipped JSONL now
 * (`docs/research/prior-art-data-sources.md` §1.1), which is what makes
 * line-oriented streaming possible at all.
 */
import { SCRYFALL_BULK_ENDPOINT, type BulkKind } from '../config';
import { RemoteShapeError } from '../errors';
import type { HttpClient } from '../http/client';
import { BulkCatalogSchema, type BulkEntry } from './schemas';

export interface BulkDescriptor {
  readonly kind: BulkKind;
  /** Upstream build timestamp; the idempotency key for "is this file new?". */
  readonly updatedAt: string;
  readonly downloadUri: string;
  readonly compressedSize: number | null;
  readonly description: string;
}

export async function fetchBulkCatalog(client: HttpClient): Promise<BulkEntry[]> {
  const catalog = await client.getJson(SCRYFALL_BULK_ENDPOINT, BulkCatalogSchema);
  return catalog.data;
}

export function selectDescriptor(entries: readonly BulkEntry[], kind: BulkKind): BulkDescriptor {
  const entry = entries.find((candidate) => candidate.type === kind);
  if (entry === undefined) {
    const available = entries.map((candidate) => candidate.type).join(', ');
    throw new RemoteShapeError(
      SCRYFALL_BULK_ENDPOINT,
      `no bulk entry of type "${kind}" (available: ${available})`,
    );
  }
  return toDescriptor(entry, kind);
}

export function toDescriptor(entry: BulkEntry, kind: BulkKind): BulkDescriptor {
  return {
    kind,
    updatedAt: entry.updated_at,
    downloadUri: entry.jsonl_download_uri,
    compressedSize: entry.compressed_size ?? null,
    description: entry.description,
  };
}

/**
 * Cache filename for a descriptor. The upstream timestamp is baked in, so a
 * rebuilt bulk file never collides with the copy already on disk and stale
 * copies stay identifiable.
 */
export function cacheFileName(descriptor: BulkDescriptor): string {
  const stamp = descriptor.updatedAt.replace(/[^0-9]/g, '').slice(0, 14);
  return `${descriptor.kind}-${stamp}.jsonl.gz`;
}
