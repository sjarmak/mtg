import { gzipSync } from 'node:zlib';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  closeStore,
  getRun,
  ingestBulkFile,
  listRejects,
  rulingId,
  storeStats,
  type DataStore,
} from '@mtg/data';
import {
  FIXTURES,
  FIXTURE_CARD_LINES,
  ORACLE_IDS,
  ORACLE_UPDATED_AT,
  RULINGS_UPDATED_AT,
  VALID_FIXTURE_CARDS,
  descriptorFor,
  memoryStore,
} from './helpers';

const ORACLE = descriptorFor('oracle_cards', ORACLE_UPDATED_AT);
const RULINGS = descriptorFor('rulings', RULINGS_UPDATED_AT);

function snapshot(store: DataStore, table: string): unknown[] {
  return store.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
}

describe('bulk ingest', () => {
  const temporaryDirs: string[] = [];

  afterEach(() => {
    for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('ingests card records into oracle_card and printing with provenance', async () => {
    const store = memoryStore();
    const result = await ingestBulkFile(store, ORACLE, FIXTURES.oracleCards);

    expect(result.status).toBe('complete');
    expect(result.rowsWritten).toBe(VALID_FIXTURE_CARDS);
    expect(result.linesRead).toBe(FIXTURE_CARD_LINES);

    const stats = storeStats(store);
    expect(stats.oracleCards).toBe(VALID_FIXTURE_CARDS);
    expect(stats.printings).toBe(VALID_FIXTURE_CARDS);
    expect(stats.sets).toBe(VALID_FIXTURE_CARDS);

    const bolt = store.db
      .prepare<[string], Record<string, unknown>>(`SELECT * FROM oracle_card WHERE oracle_id = ?`)
      .get(ORACLE_IDS.lightningBolt);
    expect(bolt?.['name']).toBe('Lightning Bolt');
    expect(bolt?.['mana_cost']).toBe('{R}');
    expect(bolt?.['color_identity']).toBe('R');
    expect(bolt?.['bulk_updated_at']).toBe(ORACLE_UPDATED_AT);
    expect(bolt?.['ingested_at']).toBe('2026-08-09T12:00:00.000Z');
    expect(JSON.parse(String(bolt?.['raw_json']))).toMatchObject({ name: 'Lightning Bolt' });

    closeStore(store);
  });

  it('reconstructs multi-face cards from card_faces', async () => {
    const store = memoryStore();
    await ingestBulkFile(store, ORACLE, FIXTURES.oracleCards);

    const split = store.db
      .prepare<[string], Record<string, unknown>>(`SELECT * FROM oracle_card WHERE oracle_id = ?`)
      .get(ORACLE_IDS.fireIce);
    expect(split?.['mana_cost']).toBe('{1}{R} // {1}{U}');
    expect(split?.['colors']).toBe('UR');
    expect(String(split?.['oracle_text'])).toContain('//');

    // Delver has no top-level mana cost, colors or P/T — all come from face 0.
    const delver = store.db
      .prepare<[string], Record<string, unknown>>(`SELECT * FROM oracle_card WHERE oracle_id = ?`)
      .get(ORACLE_IDS.delver);
    expect(delver?.['mana_cost']).toBe('{U}');
    expect(delver?.['colors']).toBe('U');
    expect(delver?.['power']).toBe('1');
    expect(delver?.['toughness']).toBe('1');

    closeStore(store);
  });

  it('pins a ruling id, so the separator can be re-encoded without moving a primary key', () => {
    expect(
      rulingId({
        oracle_id: 'ae92942b-919c-4ea9-b693-85fcef765d5a',
        published_at: '2022-12-08',
        source: 'wotc',
        comment:
          "To cast a split card, choose one of its halves to cast. There's no way to cast both halves of this split card.",
      }),
    ).toBe('ca3a58c6b764bd51a6ff664e4f3c6160776a019f52613c591bc52e3a66ede89b');
  });

  it('ingests rulings and dedupes identical records by content', async () => {
    const store = memoryStore();
    const result = await ingestBulkFile(store, RULINGS, FIXTURES.rulings);

    expect(result.status).toBe('complete');
    // 14 lines, one an exact duplicate: 13 distinct rulings survive.
    expect(result.linesRead).toBe(14);
    expect(result.rowsWritten).toBe(14);
    expect(storeStats(store).rulings).toBe(13);

    const fireIce = store.db
      .prepare<[string], { n: number }>(`SELECT COUNT(*) AS n FROM ruling WHERE oracle_id = ?`)
      .get(ORACLE_IDS.fireIce);
    expect(fireIce?.n).toBe(7);

    closeStore(store);
  });

  it('is idempotent: a forced re-ingest reproduces byte-identical rows', async () => {
    const store = memoryStore();
    await ingestBulkFile(store, ORACLE, FIXTURES.oracleCards);
    const cardsBefore = snapshot(store, 'oracle_card');
    const printingsBefore = snapshot(store, 'printing');

    const second = await ingestBulkFile(store, ORACLE, FIXTURES.oracleCards, { force: true });
    expect(second.status).toBe('complete');
    expect(second.rowsWritten).toBe(VALID_FIXTURE_CARDS);

    expect(snapshot(store, 'oracle_card')).toEqual(cardsBefore);
    expect(snapshot(store, 'printing')).toEqual(printingsBefore);
    expect(storeStats(store).oracleCards).toBe(VALID_FIXTURE_CARDS);

    closeStore(store);
  });

  it('skips a bulk file whose upstream updated_at already completed', async () => {
    const store = memoryStore();
    await ingestBulkFile(store, ORACLE, FIXTURES.oracleCards);

    const repeat = await ingestBulkFile(store, ORACLE, FIXTURES.oracleCards);
    expect(repeat.status).toBe('skipped');
    expect(repeat.linesRead).toBe(0);
    expect(repeat.rowsWritten).toBe(VALID_FIXTURE_CARDS);

    closeStore(store);
  });

  it('re-ingests when upstream publishes a newer updated_at', async () => {
    const store = memoryStore();
    await ingestBulkFile(store, ORACLE, FIXTURES.oracleCards);

    const newer = descriptorFor('oracle_cards', '2026-08-10T09:02:38.172+00:00');
    const result = await ingestBulkFile(store, newer, FIXTURES.oracleCards);

    expect(result.status).toBe('complete');
    expect(result.linesRead).toBe(FIXTURE_CARD_LINES);
    expect(storeStats(store).oracleCards).toBe(VALID_FIXTURE_CARDS);

    const run = getRun(store, 'oracle_cards');
    expect(run?.bulkUpdatedAt).toBe('2026-08-10T09:02:38.172+00:00');

    closeStore(store);
  });

  it('resumes an interrupted ingest from the committed checkpoint', async () => {
    const store = memoryStore();
    const controller = new AbortController();

    const first = await ingestBulkFile(store, ORACLE, FIXTURES.oracleCards, {
      batchSize: 2,
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });

    expect(first.status).toBe('interrupted');
    expect(first.rowsWritten).toBe(2);
    const checkpoint = getRun(store, 'oracle_cards');
    expect(checkpoint?.status).toBe('running');
    expect(checkpoint?.linesDone).toBe(2);
    expect(storeStats(store).oracleCards).toBe(2);

    const second = await ingestBulkFile(store, ORACLE, FIXTURES.oracleCards, { batchSize: 2 });
    expect(second.status).toBe('complete');
    expect(second.resumedFromLine).toBe(2);
    // Only the unread tail is re-read; the counters carry across the resume.
    expect(second.linesRead).toBe(FIXTURE_CARD_LINES - 2);
    expect(second.rowsWritten).toBe(VALID_FIXTURE_CARDS);
    expect(storeStats(store).oracleCards).toBe(VALID_FIXTURE_CARDS);

    const finished = getRun(store, 'oracle_cards');
    expect(finished?.status).toBe('complete');
    expect(finished?.linesDone).toBe(FIXTURE_CARD_LINES);

    closeStore(store);
  });

  it('a resumed ingest produces the same rows as an uninterrupted one', async () => {
    const straight = memoryStore();
    await ingestBulkFile(straight, ORACLE, FIXTURES.oracleCards);
    const expected = snapshot(straight, 'oracle_card');
    closeStore(straight);

    const resumed = memoryStore();
    const controller = new AbortController();
    await ingestBulkFile(resumed, ORACLE, FIXTURES.oracleCards, {
      batchSize: 3,
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });
    await ingestBulkFile(resumed, ORACLE, FIXTURES.oracleCards, { batchSize: 3 });

    expect(snapshot(resumed, 'oracle_card')).toEqual(expected);
    closeStore(resumed);
  });

  it('honors maxRecords and leaves the run resumable', async () => {
    const store = memoryStore();
    const limited = await ingestBulkFile(store, ORACLE, FIXTURES.oracleCards, {
      maxRecords: 3,
      batchSize: 1,
    });

    expect(limited.status).toBe('interrupted');
    expect(limited.linesRead).toBe(3);
    expect(storeStats(store).oracleCards).toBe(3);

    const rest = await ingestBulkFile(store, ORACLE, FIXTURES.oracleCards);
    expect(rest.status).toBe('complete');
    expect(storeStats(store).oracleCards).toBe(VALID_FIXTURE_CARDS);

    closeStore(store);
  });

  it('streams gzipped bulk files, detected by magic bytes not extension', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mtg-data-gz-'));
    temporaryDirs.push(dir);
    const gzPath = join(dir, 'oracle-cards.jsonl.gz');
    writeFileSync(gzPath, gzipSync(readFileSync(FIXTURES.oracleCards)));

    const store = memoryStore();
    const result = await ingestBulkFile(store, ORACLE, gzPath);

    expect(result.status).toBe('complete');
    expect(result.rowsWritten).toBe(VALID_FIXTURE_CARDS);
    expect(storeStats(store).oracleCards).toBe(VALID_FIXTURE_CARDS);

    closeStore(store);
  });
});

describe('boundary validation', () => {
  it('rejects malformed records instead of writing partial rows', async () => {
    const store = memoryStore();
    const descriptor = descriptorFor('oracle_cards', '2026-08-09T00:00:00.000+00:00');
    const result = await ingestBulkFile(store, descriptor, FIXTURES.oracleCardsMalformed);

    expect(result.status).toBe('complete');
    expect(result.rowsWritten).toBe(3);
    expect(result.rowsRejected).toBe(6);
    expect(storeStats(store).oracleCards).toBe(3);

    const reasons = listRejects(store, 'oracle_cards').map((reject) => reject.reason);
    expect(reasons).toHaveLength(6);
    expect(reasons[0]).toContain('malformed JSON');
    expect(reasons.join(' | ')).toContain('name');
    expect(reasons.join(' | ')).toContain('cmc');
    expect(reasons.join(' | ')).toContain('color_identity');
    expect(reasons.join(' | ')).toContain('oracle_id');

    closeStore(store);
  });

  it('rejects reversible_card records, which carry no top-level oracle identity', async () => {
    const store = memoryStore();
    await ingestBulkFile(store, ORACLE, FIXTURES.oracleCards);

    const rejects = listRejects(store, 'oracle_cards');
    expect(rejects).toHaveLength(1);
    expect(rejects[0]?.lineNumber).toBe(7);
    expect(rejects[0]?.reason).toContain('oracle_id');
    expect(rejects[0]?.excerpt).toContain('reversible_card');

    closeStore(store);
  });

  it('records rejects idempotently across a forced re-ingest', async () => {
    const store = memoryStore();
    await ingestBulkFile(store, ORACLE, FIXTURES.oracleCards);
    await ingestBulkFile(store, ORACLE, FIXTURES.oracleCards, { force: true });

    expect(storeStats(store).rejects).toBe(1);
    closeStore(store);
  });
});
