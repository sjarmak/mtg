/**
 * `ingest_run` — the checkpoint table that makes ingest resumable.
 *
 * Contract: the checkpoint is advanced inside the *same* SQLite transaction
 * that writes the batch's rows. A process killed mid-batch loses the whole
 * transaction, so `lines_done` can never point past data that was actually
 * committed, and never behind it by more than one batch. Resuming replays from
 * `lines_done`; because every content write is an upsert, replay is a no-op on
 * rows that survived.
 */
import type { BulkKind } from '../config';
import type { DataStore } from './store';

export type RunStatus = 'running' | 'complete';

export interface IngestRunRow {
  readonly bulk_kind: string;
  readonly bulk_updated_at: string;
  readonly download_uri: string;
  readonly content_path: string | null;
  readonly lines_done: number;
  readonly rows_written: number;
  readonly rows_rejected: number;
  readonly status: string;
  readonly started_at: string;
  readonly updated_at: string;
  readonly finished_at: string | null;
}

export interface IngestRun {
  readonly bulkKind: BulkKind;
  readonly bulkUpdatedAt: string;
  readonly downloadUri: string;
  readonly contentPath: string | null;
  readonly linesDone: number;
  readonly rowsWritten: number;
  readonly rowsRejected: number;
  readonly status: RunStatus;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly finishedAt: string | null;
}

function toRun(row: IngestRunRow): IngestRun {
  return {
    bulkKind: row.bulk_kind as BulkKind,
    bulkUpdatedAt: row.bulk_updated_at,
    downloadUri: row.download_uri,
    contentPath: row.content_path,
    linesDone: row.lines_done,
    rowsWritten: row.rows_written,
    rowsRejected: row.rows_rejected,
    status: row.status === 'complete' ? 'complete' : 'running',
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

export function getRun(store: DataStore, kind: BulkKind): IngestRun | null {
  const row = store.db
    .prepare<[string], IngestRunRow>(`SELECT * FROM ingest_run WHERE bulk_kind = ?`)
    .get(kind);
  return row === undefined ? null : toRun(row);
}

export function listRuns(store: DataStore): IngestRun[] {
  const rows = store.db.prepare<[], IngestRunRow>(`SELECT * FROM ingest_run ORDER BY bulk_kind`).all();
  return rows.map(toRun);
}

export interface StartRunInput {
  readonly bulkKind: BulkKind;
  readonly bulkUpdatedAt: string;
  readonly downloadUri: string;
  readonly contentPath: string | null;
  /** Force the checkpoint back to zero even when the run looks resumable. */
  readonly reset?: boolean;
}

/**
 * Creates or resets the run row for `bulkKind`. Resets the checkpoint whenever
 * the upstream `updated_at` differs from the recorded one — a new bulk file is
 * a different file, and its line numbers mean nothing to the old checkpoint.
 */
export function startRun(store: DataStore, input: StartRunInput): IngestRun {
  const now = store.now();
  const existing = getRun(store, input.bulkKind);
  const resumable =
    input.reset !== true &&
    existing !== null &&
    existing.bulkUpdatedAt === input.bulkUpdatedAt &&
    existing.status === 'running';

  if (resumable) {
    store.db
      .prepare(`UPDATE ingest_run SET download_uri = ?, content_path = ?, updated_at = ? WHERE bulk_kind = ?`)
      .run(input.downloadUri, input.contentPath, now, input.bulkKind);
  } else {
    store.db
      .prepare(
        `INSERT INTO ingest_run (
           bulk_kind, bulk_updated_at, download_uri, content_path,
           lines_done, rows_written, rows_rejected, status, started_at, updated_at, finished_at
         ) VALUES (?, ?, ?, ?, 0, 0, 0, 'running', ?, ?, NULL)
         ON CONFLICT(bulk_kind) DO UPDATE SET
           bulk_updated_at = excluded.bulk_updated_at,
           download_uri = excluded.download_uri,
           content_path = excluded.content_path,
           lines_done = 0, rows_written = 0, rows_rejected = 0,
           status = 'running', started_at = excluded.started_at,
           updated_at = excluded.updated_at, finished_at = NULL`,
      )
      .run(input.bulkKind, input.bulkUpdatedAt, input.downloadUri, input.contentPath, now, now);
  }

  const run = getRun(store, input.bulkKind);
  if (run === null) throw new Error(`ingest_run row for ${input.bulkKind} vanished immediately after write`);
  return run;
}

export interface CheckpointInput {
  readonly bulkKind: BulkKind;
  readonly linesDone: number;
  readonly rowsWritten: number;
  readonly rowsRejected: number;
}

/** Advances the checkpoint. Must be called inside the batch's transaction. */
export function checkpointRun(store: DataStore, input: CheckpointInput): void {
  store.db
    .prepare(
      `UPDATE ingest_run
         SET lines_done = ?, rows_written = ?, rows_rejected = ?, updated_at = ?
       WHERE bulk_kind = ?`,
    )
    .run(input.linesDone, input.rowsWritten, input.rowsRejected, store.now(), input.bulkKind);
}

export function completeRun(store: DataStore, input: CheckpointInput): void {
  const now = store.now();
  store.db
    .prepare(
      `UPDATE ingest_run
         SET lines_done = ?, rows_written = ?, rows_rejected = ?,
             status = 'complete', updated_at = ?, finished_at = ?
       WHERE bulk_kind = ?`,
    )
    .run(input.linesDone, input.rowsWritten, input.rowsRejected, now, now, input.bulkKind);
}

export function countRejects(store: DataStore, kind: BulkKind): number {
  const row = store.db
    .prepare<[string], { n: number }>(`SELECT COUNT(*) AS n FROM ingest_reject WHERE bulk_kind = ?`)
    .get(kind);
  return row?.n ?? 0;
}

export interface RejectRecord {
  readonly bulkKind: string;
  readonly lineNumber: number;
  readonly reason: string;
  readonly excerpt: string;
  readonly rejectedAt: string;
}

export function listRejects(store: DataStore, kind: BulkKind, limit = 20): RejectRecord[] {
  const rows = store.db
    .prepare<
      [string, number],
      { bulk_kind: string; line_number: number; reason: string; excerpt: string; rejected_at: string }
    >(`SELECT * FROM ingest_reject WHERE bulk_kind = ? ORDER BY line_number LIMIT ?`)
    .all(kind, limit);
  return rows.map((row) => ({
    bulkKind: row.bulk_kind,
    lineNumber: row.line_number,
    reason: row.reason,
    excerpt: row.excerpt,
    rejectedAt: row.rejected_at,
  }));
}
