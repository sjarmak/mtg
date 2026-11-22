/** Build browser artifacts from Forge ranks without reading Forge data in this process. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { printedSourceFingerprint } from '@mtg/draft-export';
import { createInstalledForgeDraftRankingReader } from '@mtg/forge-export';
import type { ForgeDraftRankingReader } from '@mtg/forge-export';
import { parsePrintedCardCatalog, parsePrintedFormat } from '@mtg/printed-card';
import type { PrintedFormat, PrintedLimitedFormat } from '@mtg/printed-card';
import {
  PrintedDraftRatingsSchema,
  printedDraftRatingsFingerprintInput,
} from '../src/lab/printed-draft-ratings';
import type { PrintedDraftRatings } from '../src/lab/printed-draft-ratings';
import type { PrintedFormatSource } from './stage-printed-formats';

export interface BuiltPrintedDraftRatings {
  readonly artifacts: ReadonlyMap<string, PrintedDraftRatings>;
  readonly messages: readonly string[];
}

type RankingReaderFactory = () => ForgeDraftRankingReader | null;

/** An unusable local Forge toolchain degrades exactly like a missing installation. */
export async function buildInstalledPrintedDraftRatings(
  sources: readonly PrintedFormatSource[],
  createReader: RankingReaderFactory = createInstalledForgeDraftRankingReader,
): Promise<BuiltPrintedDraftRatings> {
  let reader: ForgeDraftRankingReader | null;
  try {
    reader = createReader();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      artifacts: new Map(),
      messages: sources.map((source) => `${formatId(source)}: Forge draft rankings unavailable (${message})`),
    };
  }
  try {
    return await buildPrintedDraftRatings(sources, reader);
  } finally {
    reader?.dispose();
  }
}

export async function buildPrintedDraftRatings(
  sources: readonly PrintedFormatSource[],
  reader: ForgeDraftRankingReader | null,
): Promise<BuiltPrintedDraftRatings> {
  if (reader === null) {
    return {
      artifacts: new Map(),
      messages: sources.map((source) => `${formatId(source)}: Forge draft rankings unavailable`),
    };
  }
  const artifacts = new Map<string, PrintedDraftRatings>();
  const messages: string[] = [];
  for (const source of sources) {
    const format = readFormat(source);
    if (format.kind === 'printed-constructed-format') {
      messages.push(`${format.id}: fixed decks, no draft to rank`);
      continue;
    }
    const draftable = draftablePhysicalIds(format);
    const catalogs = [];
    let totalRanked = 0;
    const perCatalogMissing: { code: string; count: number; ranked: number; names: string[] }[] = [];
    try {
      for (const catalogSource of source.catalogs) {
        const catalog = parsePrintedCardCatalog(
          JSON.parse(readFileSync(join(source.directory, catalogSource.file), 'utf8')),
        );
        const ranks = await reader.read(
          catalogSource.code,
          catalog.cards.map((card) => card.correctedName),
        );
        let ranked = 0;
        const catalogMissing: string[] = [];
        const cards = catalog.cards.map((card, index) => {
          const rank = ranks[index];
          if (rank === null || rank === undefined) {
            if (!/\bBasic Land\b/u.test(card.typeLine) && draftable.has(card.physicalId))
              catalogMissing.push(`${catalogSource.code}:${card.correctedName}`);
            return {
              physicalId: card.physicalId,
              sourceFingerprint: printedSourceFingerprint(card),
              quality: null,
            };
          }
          ranked += 1;
          return {
            physicalId: card.physicalId,
            sourceFingerprint: printedSourceFingerprint(card),
            quality: 5 * (1 - rank),
          };
        });
        totalRanked += ranked;
        if (catalogMissing.length > 0)
          perCatalogMissing.push({
            code: catalogSource.code,
            count: catalogMissing.length,
            ranked,
            names: catalogMissing,
          });
        catalogs.push({
          code: catalogSource.code,
          catalogSha256: catalog.contentSha256,
          cards,
        });
      }
    } catch (cause) {
      messages.push(
        `${format.id}: Forge ranking read failed (${cause instanceof Error ? cause.message : String(cause)})`,
      );
      continue;
    }
    /**
     * A catalog with zero ranked cards among catalogs Forge does rank some of is a
     * sheet Forge ships no ranking list for at all (Amonkhet's Invocations), not a
     * gap. But when the whole format ranks nothing, that is a broken install or a
     * name mismatch, and it must still fail loudly rather than stage silently.
     */
    const gaps =
      totalRanked === 0
        ? perCatalogMissing.flatMap((m) => m.names)
        : perCatalogMissing.filter((m) => m.ranked > 0).flatMap((m) => m.names);
    const unrankedSheets =
      totalRanked === 0
        ? []
        : perCatalogMissing.filter((m) => m.ranked === 0).map((m) => ({ code: m.code, count: m.count }));
    if (gaps.length > 0) {
      messages.push(
        `${format.id}: no complete Forge ranking (${String(gaps.length)} nonbasic cards missing; first ${gaps[0]!})`,
      );
      continue;
    }
    const ratingSource = {
      kind: 'forge-limited-rankings' as const,
      version: reader.forgeVersion,
      bridgeFingerprint: reader.fingerprint,
    };
    const fingerprint = createHash('sha256')
      .update(printedDraftRatingsFingerprintInput(ratingSource, catalogs))
      .digest('hex');
    const artifact = PrintedDraftRatingsSchema.parse({
      schemaVersion: 1,
      kind: 'printed-draft-ratings',
      source: {
        ...ratingSource,
        fingerprint,
      },
      catalogs,
    });
    artifacts.set(format.id, artifact);
    const total = catalogs.flatMap((c) => c.cards).length;
    const unrankedNote =
      unrankedSheets.length > 0
        ? `; ${unrankedSheets.map((s) => `${s.code} unranked, ${String(s.count)} cards Forge ships no ranking list for`).join('; ')}`
        : '';
    messages.push(
      `${format.id}: Forge-ranked deck-aware draft policy (${String(total)} cards${unrankedNote})`,
    );
  }
  return { artifacts, messages };
}

/**
 * The cards a pack can deal. A catalog can carry printings no booster sheet
 * names (Ixalan's ten planeswalker-deck cards), and Forge has no draft rank
 * for them; that is not a gap in the ranking, since no draft can seat one.
 */
function draftablePhysicalIds(format: PrintedLimitedFormat): ReadonlySet<string> {
  return new Set(
    format.products.flatMap((product) =>
      product.collation.sheets.flatMap((sheet) => Object.keys(sheet.weights)),
    ),
  );
}

/** Either printed format kind; a constructed format stages beside the limited ones and drafts nothing. */
function readFormat(source: PrintedFormatSource): PrintedFormat {
  return parsePrintedFormat(JSON.parse(readFileSync(join(source.directory, source.formatFile), 'utf8')));
}

function formatId(source: PrintedFormatSource): string {
  return readFormat(source).id;
}

export function describePrintedDraftRatings(result: BuiltPrintedDraftRatings): string {
  return `Printed draft bots: ${result.messages.join('; ')}.`;
}
