/**
 * Fetching, persisting and reloading the MTGJSON vocabulary.
 *
 * The three files total well under a megabyte, so they are fetched whole
 * rather than streamed — the streaming machinery exists for Scryfall's
 * hundred-megabyte bulk files, and using it here would be ceremony.
 */
import { z } from 'zod';
import { MTGJSON_BASE } from '../config';
import { InvalidInputError } from '../errors';
import { createHttpClient, type HttpClient } from '../http/client';
import type { DataStore } from '../store/store';
import {
  CardTypesFileSchema,
  EnumValuesFileSchema,
  KeywordsFileSchema,
  VOCABULARY_KINDS,
  type CardTypesFile,
  type EnumValuesFile,
  type KeywordsFile,
  type VocabularyKind,
} from './schemas';
import { buildVocabulary, type MtgVocabulary, type VocabularyFiles } from './vocabulary';

export interface VocabularyIngestOptions {
  readonly client?: HttpClient;
  readonly baseUrl?: string;
}

export interface VocabularyIngestResult {
  readonly kind: VocabularyKind;
  readonly version: string;
  readonly builtDate: string;
  readonly bytes: number;
}

async function fetchOne<T>(
  client: HttpClient,
  baseUrl: string,
  kind: VocabularyKind,
  schema: z.ZodType<T>,
): Promise<T> {
  return client.getJson(`${baseUrl}/${kind}.json`, schema);
}

/** Downloads all three vocabulary files and validates them at the boundary. */
export async function fetchVocabularyFiles(options: VocabularyIngestOptions = {}): Promise<VocabularyFiles> {
  const client = options.client ?? createHttpClient();
  const baseUrl = options.baseUrl ?? MTGJSON_BASE;
  const [cardTypes, keywords, enumValues] = await Promise.all([
    fetchOne(client, baseUrl, 'CardTypes', CardTypesFileSchema),
    fetchOne(client, baseUrl, 'Keywords', KeywordsFileSchema),
    fetchOne(client, baseUrl, 'EnumValues', EnumValuesFileSchema),
  ]);
  return { cardTypes, keywords, enumValues };
}

/** Persists the raw files verbatim, one row per kind, with build provenance. */
export function saveVocabularyFiles(store: DataStore, files: VocabularyFiles): VocabularyIngestResult[] {
  const now = store.now();
  const payloads: ReadonlyArray<{
    kind: VocabularyKind;
    meta: { version: string; date: string };
    body: unknown;
  }> = [
    { kind: 'CardTypes', meta: files.cardTypes.meta, body: files.cardTypes },
    { kind: 'Keywords', meta: files.keywords.meta, body: files.keywords },
    { kind: 'EnumValues', meta: files.enumValues.meta, body: files.enumValues },
  ];

  const statement = store.db.prepare(
    `INSERT INTO vocabulary (kind, version, built_date, raw_json, ingested_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(kind) DO UPDATE SET
       version = excluded.version,
       built_date = excluded.built_date,
       raw_json = excluded.raw_json,
       ingested_at = excluded.ingested_at`,
  );

  const results: VocabularyIngestResult[] = [];
  const write = store.db.transaction(() => {
    for (const payload of payloads) {
      const raw = JSON.stringify(payload.body);
      statement.run(payload.kind, payload.meta.version, payload.meta.date, raw, now);
      results.push({
        kind: payload.kind,
        version: payload.meta.version,
        builtDate: payload.meta.date,
        bytes: raw.length,
      });
    }
  });
  write();
  return results;
}

export async function ingestVocabulary(
  store: DataStore,
  options: VocabularyIngestOptions = {},
): Promise<VocabularyIngestResult[]> {
  const files = await fetchVocabularyFiles(options);
  return saveVocabularyFiles(store, files);
}

const SCHEMA_BY_KIND = {
  CardTypes: CardTypesFileSchema,
  Keywords: KeywordsFileSchema,
  EnumValues: EnumValuesFileSchema,
} as const;

function readKind<K extends VocabularyKind>(
  store: DataStore,
  kind: K,
): z.infer<(typeof SCHEMA_BY_KIND)[K]> | null {
  const row = store.db
    .prepare<[string], { raw_json: string }>(`SELECT raw_json FROM vocabulary WHERE kind = ?`)
    .get(kind);
  if (row === undefined) return null;
  const parsed = SCHEMA_BY_KIND[kind].safeParse(JSON.parse(row.raw_json));
  if (!parsed.success) {
    throw new InvalidInputError(`stored ${kind} vocabulary`, z.prettifyError(parsed.error));
  }
  return parsed.data as z.infer<(typeof SCHEMA_BY_KIND)[K]>;
}

/** Rebuilds the vocabulary from the store, or `null` if it was never ingested. */
export function loadVocabulary(store: DataStore): MtgVocabulary | null {
  const cardTypes = readKind(store, 'CardTypes') as CardTypesFile | null;
  const keywords = readKind(store, 'Keywords') as KeywordsFile | null;
  const enumValues = readKind(store, 'EnumValues') as EnumValuesFile | null;
  if (cardTypes === null || keywords === null || enumValues === null) return null;
  return buildVocabulary({ cardTypes, keywords, enumValues });
}

export function vocabularyStatus(
  store: DataStore,
): Array<{ kind: string; version: string; ingestedAt: string }> {
  const rows = store.db
    .prepare<[], { kind: string; version: string; ingested_at: string }>(
      `SELECT kind, version, ingested_at FROM vocabulary ORDER BY kind`,
    )
    .all();
  return rows.map((row) => ({ kind: row.kind, version: row.version, ingestedAt: row.ingested_at }));
}

export { VOCABULARY_KINDS };
