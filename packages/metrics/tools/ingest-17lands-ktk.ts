/**
 * Ingests 17lands' KTK GAME dataset and derives per-card win-rate-when-drawn,
 * staged for `resolveCardRating`'s rung 1 (ADR-0005). `mtg-1j00i.2`.
 *
 * Node-only by design, like `@mtg/image-cache`: this is the one place in the
 * metrics package that touches the network, so `packages/metrics/src/calibration.ts`
 * stays a download-free contract.
 *
 * The statistic itself is not reimplemented here — every row this parses
 * reduces to a `WinRateGameRow` and is fed through the same accumulator
 * `cardWinRatesWhenDrawn` (self-play) builds on, in `../src/card-win-rate.ts`.
 *
 * GAME, not draft_data: `draft_data` carries picks with no win-when-drawn
 * columns, so it cannot answer this bead's question at all.
 *
 * Fetched once into `data/cache/` (gitignored) and never refetched once
 * present; a HEAD check runs first and the tool stops rather than guessing
 * when the file is not where 17lands says it is.
 */
import { createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import { createCardWinRateAccumulator } from '../src/card-win-rate';
import type { CardHandCounts, CardWinRateRecord, WinRateGameRow } from '../src/card-win-rate';
import { DEFAULT_METRICS_CONFIG } from '../src/config';
import { SEVENTEEN_LANDS_ATTRIBUTION } from '../src/calibration';

const SET_CODE = 'KTK';
const SOURCE_URL =
  'https://17lands-public.s3.amazonaws.com/analysis_data/game_data/game_data_public.KTK.PremierDraft.csv.gz';
const CACHE_DIR = 'data/cache';
const CACHE_FILE = join(CACHE_DIR, 'game_data_public.KTK.PremierDraft.csv.gz');
const OUT_PATH = 'packages/metrics/data/17lands-ktk-card-win-rate-v1.json';
const PRINTED_CATALOG_PATH = 'packages/data/data/ktk/ktk-printed-catalog-v1.json';

/**
 * `won` is column 17 (0-indexed) of the GAME dataset's 18 fixed columns,
 * verified live against the published file 2026-09-22:
 * expansion, event_type, draft_id, draft_time, game_time, build_index,
 * match_number, game_number, rank, opp_rank, main_colors, splash_colors,
 * on_play, num_mulligans, opp_num_mulligans, opp_colors, num_turns, won.
 * Per-card columns follow in groups of 5, in this order:
 * opening_hand_<name>, drawn_<name>, tutored_<name>, deck_<name>, sideboard_<name>.
 */
const FIXED_COLUMN_COUNT = 18;
const DRAFT_ID_COLUMN = 2;
const MATCH_NUMBER_COLUMN = 6;
const GAME_NUMBER_COLUMN = 7;
const WON_COLUMN = 17;
const CARD_GROUP_SIZE = 5;

interface CardColumn {
  readonly cardName: string;
  readonly openingHandIndex: number;
  readonly drawnIndex: number;
}

/** Quote-aware split, needed only for the header row (card names can hold commas). */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') inQuotes = true;
    else if (char === ',') {
      fields.push(current);
      current = '';
    } else current += char;
  }
  fields.push(current);
  return fields;
}

function parseCardColumns(header: readonly string[]): readonly CardColumn[] {
  const columns: CardColumn[] = [];
  for (let i = FIXED_COLUMN_COUNT; i + CARD_GROUP_SIZE <= header.length; i += CARD_GROUP_SIZE) {
    const openingHandField = header[i];
    if (openingHandField === undefined || !openingHandField.startsWith('opening_hand_')) {
      throw new Error(
        `Expected an opening_hand_ column at index ${String(i)}, got ${String(openingHandField)}`,
      );
    }
    columns.push({
      cardName: openingHandField.slice('opening_hand_'.length),
      openingHandIndex: i,
      drawnIndex: i + 1,
    });
  }
  return columns;
}

async function headCheck(url: string): Promise<void> {
  const response = await fetch(url, { method: 'HEAD' });
  if (!response.ok) {
    throw new Error(`17lands GAME dataset not found at ${url}: HTTP ${String(response.status)}`);
  }
}

async function downloadToCache(url: string, destPath: string): Promise<void> {
  if (existsSync(destPath)) return;
  await mkdir(dirname(destPath), { recursive: true });
  const response = await fetch(url);
  if (!response.ok || response.body === null) {
    throw new Error(`GET ${url} failed: HTTP ${String(response.status)}`);
  }
  const expected = Number(response.headers.get('content-length') ?? 'NaN');
  const partial = `${destPath}.part`;
  await rm(partial, { force: true });
  let bytes = 0;
  const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  source.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
  });
  try {
    await pipeline(source, createWriteStream(partial));
  } catch (cause) {
    await rm(partial, { force: true });
    throw cause;
  }
  if (Number.isFinite(expected) && bytes !== expected) {
    await rm(partial, { force: true });
    throw new Error(
      `Download of ${url} was truncated: expected ${String(expected)} bytes, got ${String(bytes)}`,
    );
  }
  await rename(partial, destPath);
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

interface ParsedGameRows {
  readonly rows: readonly WinRateGameRow[];
  readonly totalDataRows: number;
  readonly decidedRows: number;
}

async function parseGameRows(gzPath: string): Promise<ParsedGameRows> {
  const stream = createReadStream(gzPath).pipe(createGunzip());
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let cardColumns: readonly CardColumn[] | null = null;
  let totalDataRows = 0;
  let decidedRows = 0;
  const rows: WinRateGameRow[] = [];
  for await (const line of rl) {
    if (cardColumns === null) {
      cardColumns = parseCardColumns(parseCsvLine(line));
      continue;
    }
    if (line.length === 0) continue;
    totalDataRows += 1;
    const fields = line.split(',');
    const wonField = fields[WON_COLUMN];
    if (wonField !== 'True' && wonField !== 'False') continue;
    decidedRows += 1;
    const cards: Record<string, CardHandCounts> = {};
    for (const column of cardColumns) {
      const openingHand = Number(fields[column.openingHandIndex]);
      const drawn = Number(fields[column.drawnIndex]);
      if (openingHand + drawn > 0) cards[column.cardName] = { opening_hand: openingHand, drawn };
    }
    rows.push({
      won: wonField === 'True',
      fingerprint: `${String(fields[DRAFT_ID_COLUMN])}:${String(fields[MATCH_NUMBER_COLUMN])}:${String(fields[GAME_NUMBER_COLUMN])}`,
      cards,
    });
  }
  return { rows, totalDataRows, decidedRows };
}

interface MappedCard {
  readonly physicalId: string;
  readonly cardName: string;
  readonly gamesInHand: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRate: number | null;
  readonly samples: number;
  readonly distinctSamples: number;
  readonly floor: number;
  readonly underSampled: boolean;
}

interface UnmappedCard {
  readonly cardName: string;
  readonly reason: string;
}

export interface CatalogNameIndex {
  readonly byName: ReadonlyMap<string, string>;
  readonly byCorrectedName: ReadonlyMap<string, string>;
}

/**
 * Joins a 17lands card name straight to the KTK printed catalog, never
 * through the store: the store holds one printing per oracle card, kept for
 * reasons unrelated to KTK membership, so testing its stored set code drops
 * any KTK card whose kept printing is from another set (mtg-uiaxh — 108 of
 * 254 KTK cards this way). The catalog already carries the canonical
 * `physicalId` (`packages/data/src/printed-card/entry.ts`'s
 * `${format}:${position.padStart(4,'0')}:${scryfallId}`), the same id
 * `findPrintedDraftQuality` (`packages/ui/src/lab/printed-draft-ratings.ts`)
 * looks ratings up by, so no id needs to be invented.
 *
 * A name can appear more than once in the catalog (the basic lands' several
 * arts, and any other alternate printing sharing a name), and 17lands does
 * not distinguish between them, so the lowest catalog position wins — first
 * occurrence in array order, since the catalog is written in position order.
 *
 * 17lands writes the front face of a split or double-faced card, which can
 * differ from the catalog's full `name`; `byCorrectedName` is the fallback
 * for that case.
 */
export function loadPhysicalIdsByName(catalogPath: string): CatalogNameIndex {
  const catalog = parsePrintedCardCatalog(JSON.parse(readFileSync(catalogPath, 'utf8')));
  const byName = new Map<string, string>();
  const byCorrectedName = new Map<string, string>();
  for (const card of catalog.cards) {
    if (!byName.has(card.name)) byName.set(card.name, card.physicalId);
    if (!byCorrectedName.has(card.correctedName)) byCorrectedName.set(card.correctedName, card.physicalId);
  }
  return { byName, byCorrectedName };
}

function mapCardsToPhysicalIds(
  records: readonly CardWinRateRecord[],
  catalogIndex: CatalogNameIndex,
): { readonly mapped: readonly MappedCard[]; readonly unmapped: readonly UnmappedCard[] } {
  const mapped: MappedCard[] = [];
  const unmapped: UnmappedCard[] = [];
  for (const record of records) {
    const byName = catalogIndex.byName.get(record.cardName);
    const physicalId = byName ?? catalogIndex.byCorrectedName.get(record.cardName);
    if (physicalId === undefined) {
      unmapped.push({
        cardName: record.cardName,
        reason: `no ${SET_CODE} printed-catalog entry matches name or corrected name "${record.cardName}"`,
      });
      continue;
    }
    mapped.push({
      physicalId,
      cardName: record.cardName,
      gamesInHand: record.gamesInHand,
      wins: record.wins,
      losses: record.losses,
      winRate: record.winRate.value,
      samples: record.winRate.samples,
      distinctSamples: record.winRate.distinctSamples,
      floor: record.winRate.floor,
      underSampled: record.winRate.underSampled,
    });
  }
  return { mapped, unmapped };
}

interface StagedArtifact {
  readonly schemaVersion: 1;
  readonly set: typeof SET_CODE;
  readonly source: {
    readonly url: string;
    readonly sha256: string;
    readonly fetchedAt: string;
  };
  readonly attribution: string;
  readonly caveats: readonly [string, string];
  readonly cards: readonly MappedCard[];
  readonly unmapped: readonly UnmappedCard[];
}

async function writeJsonAtomic(outputPath: string, data: unknown): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = join(
    dirname(outputPath),
    `.${basename(outputPath)}.${String(process.pid)}.${randomUUID()}.tmp`,
  );
  await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, outputPath);
}

async function main(): Promise<void> {
  await headCheck(SOURCE_URL);
  await downloadToCache(SOURCE_URL, CACHE_FILE);
  const sha256 = await sha256File(CACHE_FILE);

  const { rows, totalDataRows, decidedRows } = await parseGameRows(CACHE_FILE);
  const accumulator = createCardWinRateAccumulator();
  for (const row of rows) accumulator.add(row);
  const records = accumulator.finish(DEFAULT_METRICS_CONFIG);

  const catalogIndex = loadPhysicalIdsByName(resolve(PRINTED_CATALOG_PATH));
  const { mapped, unmapped } = mapCardsToPhysicalIds(records, catalogIndex);

  const artifact: StagedArtifact = {
    schemaVersion: 1,
    set: SET_CODE,
    source: { url: SOURCE_URL, sha256, fetchedAt: new Date().toISOString() },
    attribution: SEVENTEEN_LANDS_ATTRIBUTION,
    caveats: [
      'The Arena KTK run this data comes from is a 2024 re-release drafted by a modern player base, not the 2014 original.',
      "A win rate is an absolute proportion while the evaluator's rating is ordinal within a set, so the two are not interchangeable even after rescaling.",
    ],
    cards: mapped,
    unmapped,
  };

  await writeJsonAtomic(resolve(OUT_PATH), artifact);

  process.stdout.write(
    `${JSON.stringify(
      {
        rowsRead: totalDataRows,
        decidedGames: decidedRows,
        cardsMapped: mapped.length,
        cardsUnmapped: unmapped.length,
        out: OUT_PATH,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `17lands KTK ingest failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
