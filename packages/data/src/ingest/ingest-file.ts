/**
 * The resumable, idempotent ingest loop over one local bulk file.
 *
 * Shape of the guarantee:
 *  - Lines are parsed and validated outside the transaction (pure CPU), then a
 *    whole batch of rows, its reject log and the checkpoint commit together.
 *    Crash mid-batch and SQLite rolls the batch back; the checkpoint still
 *    describes exactly what is on disk.
 *  - Every content write is an upsert, so replaying a batch after a crash, or
 *    re-running the same file end to end, converges to identical rows.
 *  - A file whose upstream `updated_at` already completed is skipped outright.
 */
import type { BulkKind, Source } from '../config';
import { CARD_BULK_KINDS, DEFAULT_BATCH_SIZE, DEFAULT_REJECT_LOG_LIMIT } from '../config';
import type { BulkDescriptor } from '../scryfall/catalog';
import { toOracleCardRow, toPrintingRow, toRulingRow, type MapContext } from '../scryfall/mappers';
import {
  issueSummary,
  ScryfallCardSchema,
  ScryfallRulingSchema,
  type ScryfallCard,
  type ScryfallRuling,
} from '../scryfall/schemas';
import { readJsonlLines } from '../stream/jsonl';
import { checkpointRun, completeRun, getRun, startRun } from '../store/runs';
import type { DataStore } from '../store/store';
import { createWriters, type Writers } from '../store/writers';

export type IngestStatus = 'complete' | 'interrupted' | 'skipped';

export interface IngestProgress {
  readonly kind: BulkKind;
  readonly linesRead: number;
  readonly rowsWritten: number;
  readonly rowsRejected: number;
}

export interface IngestResult {
  readonly kind: BulkKind;
  readonly bulkUpdatedAt: string;
  readonly status: IngestStatus;
  readonly resumedFromLine: number;
  readonly linesRead: number;
  readonly rowsWritten: number;
  readonly rowsRejected: number;
}

export interface IngestFileOptions {
  readonly batchSize?: number;
  /** Stop after this many records *in this run*; the run stays resumable. */
  readonly maxRecords?: number;
  readonly rejectLogLimit?: number;
  /** Re-ingest even if this exact `updated_at` already completed. */
  readonly force?: boolean;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: IngestProgress) => void;
  readonly source?: Source;
}

type Prepared =
  | {
      readonly outcome: 'card';
      readonly lineNumber: number;
      readonly raw: string;
      readonly card: ScryfallCard;
    }
  | {
      readonly outcome: 'ruling';
      readonly lineNumber: number;
      readonly raw: string;
      readonly ruling: ScryfallRuling;
    }
  | {
      readonly outcome: 'reject';
      readonly lineNumber: number;
      readonly raw: string;
      readonly reason: string;
    };

function prepareLine(kind: BulkKind, lineNumber: number, text: string): Prepared {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (cause) {
    const reason = cause instanceof Error ? `malformed JSON: ${cause.message}` : 'malformed JSON';
    return { outcome: 'reject', lineNumber, raw: text, reason };
  }

  if (CARD_BULK_KINDS.includes(kind)) {
    const parsed = ScryfallCardSchema.safeParse(value);
    if (!parsed.success) {
      return { outcome: 'reject', lineNumber, raw: text, reason: issueSummary(parsed.error) };
    }
    return { outcome: 'card', lineNumber, raw: text, card: parsed.data };
  }

  const parsed = ScryfallRulingSchema.safeParse(value);
  if (!parsed.success) {
    return { outcome: 'reject', lineNumber, raw: text, reason: issueSummary(parsed.error) };
  }
  return { outcome: 'ruling', lineNumber, raw: text, ruling: parsed.data };
}

interface Counters {
  linesDone: number;
  rowsWritten: number;
  rowsRejected: number;
}

function applyBatch(
  store: DataStore,
  writers: Writers,
  kind: BulkKind,
  descriptor: BulkDescriptor,
  source: Source,
  batch: readonly Prepared[],
  counters: Counters,
  rejectLogLimit: number,
): void {
  const now = store.now();
  const context = (raw: string): MapContext => ({
    source,
    bulkUpdatedAt: descriptor.updatedAt,
    ingestedAt: now,
    rawJson: raw,
  });

  for (const item of batch) {
    switch (item.outcome) {
      case 'card': {
        writers.oracleCard.run(toOracleCardRow(item.card, context(item.raw)));
        writers.printing.run(toPrintingRow(item.card, context(item.raw)));
        counters.rowsWritten += 1;
        break;
      }
      case 'ruling': {
        writers.ruling.run(toRulingRow(item.ruling, context(item.raw)));
        counters.rowsWritten += 1;
        break;
      }
      case 'reject': {
        counters.rowsRejected += 1;
        if (counters.rowsRejected <= rejectLogLimit) {
          writers.reject.run({
            bulk_kind: kind,
            line_number: item.lineNumber,
            reason: item.reason,
            excerpt: item.raw.slice(0, 500),
            rejected_at: now,
          });
        }
        break;
      }
    }
    counters.linesDone = item.lineNumber;
  }

  checkpointRun(store, {
    bulkKind: kind,
    linesDone: counters.linesDone,
    rowsWritten: counters.rowsWritten,
    rowsRejected: counters.rowsRejected,
  });
}

/**
 * Ingests a bulk file already on disk (gzipped or plain JSONL). This is the
 * whole ingest engine; `ingestFromScryfall` only adds catalog lookup and
 * download in front of it.
 */
export async function ingestBulkFile(
  store: DataStore,
  descriptor: BulkDescriptor,
  filePath: string,
  options: IngestFileOptions = {},
): Promise<IngestResult> {
  const kind = descriptor.kind;
  const source: Source = options.source ?? 'scryfall';
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
  const rejectLogLimit = options.rejectLogLimit ?? DEFAULT_REJECT_LOG_LIMIT;

  const previous = getRun(store, kind);
  if (
    options.force !== true &&
    previous !== null &&
    previous.status === 'complete' &&
    previous.bulkUpdatedAt === descriptor.updatedAt
  ) {
    return {
      kind,
      bulkUpdatedAt: descriptor.updatedAt,
      status: 'skipped',
      resumedFromLine: previous.linesDone,
      linesRead: 0,
      rowsWritten: previous.rowsWritten,
      rowsRejected: previous.rowsRejected,
    };
  }

  const run = startRun(store, {
    bulkKind: kind,
    bulkUpdatedAt: descriptor.updatedAt,
    downloadUri: descriptor.downloadUri,
    contentPath: filePath,
    reset: options.force === true,
  });
  // `startRun` zeroed the checkpoint under `force`, so this is 0 there and the
  // last committed line on a resume.
  const resumedFromLine = run.linesDone;
  const counters: Counters = {
    linesDone: resumedFromLine,
    rowsWritten: run.rowsWritten,
    rowsRejected: run.rowsRejected,
  };

  const writers = createWriters(store);
  const commit = store.db.transaction((batch: readonly Prepared[]) => {
    applyBatch(store, writers, kind, descriptor, source, batch, counters, rejectLogLimit);
  });

  const readOptions =
    options.signal === undefined
      ? { startLine: resumedFromLine }
      : { startLine: resumedFromLine, signal: options.signal };

  let batch: Prepared[] = [];
  let linesRead = 0;
  let interrupted = false;

  for await (const line of readJsonlLines(filePath, readOptions)) {
    batch.push(prepareLine(kind, line.lineNumber, line.text));
    linesRead += 1;

    if (batch.length >= batchSize) {
      commit(batch);
      batch = [];
      options.onProgress?.({
        kind,
        linesRead,
        rowsWritten: counters.rowsWritten,
        rowsRejected: counters.rowsRejected,
      });
    }

    if (options.signal?.aborted === true) {
      interrupted = true;
      break;
    }
    if (options.maxRecords !== undefined && linesRead >= options.maxRecords) {
      interrupted = true;
      break;
    }
  }

  if (batch.length > 0) commit(batch);

  if (!interrupted) {
    completeRun(store, {
      bulkKind: kind,
      linesDone: counters.linesDone,
      rowsWritten: counters.rowsWritten,
      rowsRejected: counters.rowsRejected,
    });
  }

  options.onProgress?.({
    kind,
    linesRead,
    rowsWritten: counters.rowsWritten,
    rowsRejected: counters.rowsRejected,
  });

  return {
    kind,
    bulkUpdatedAt: descriptor.updatedAt,
    status: interrupted ? 'interrupted' : 'complete',
    resumedFromLine,
    linesRead,
    rowsWritten: counters.rowsWritten,
    rowsRejected: counters.rowsRejected,
  };
}
