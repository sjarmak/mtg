/** Bounded full-deck discovery through Forge's observed interaction contract. */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { preparePrintedLimitedFormat } from '@mtg/draft-export';
import type { DeckRef, ObservedBackend, SessionSpec } from '@mtg/engine';
import {
  compileInstalledForgeBridge,
  installedForgeDiagnosticBackend,
  runObservedDiagnosticSession,
} from '@mtg/forge-export';
import type { ObservedDiagnosticSessionReport } from '@mtg/forge-export';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import { samplePrintedLimitedDecks } from './printed-limited-decks';
import { buildPrintedCatalogCoverageDeckPairs } from './printed-catalog-coverage-decks';

const OptionsSchema = z.strictObject({
  format: z.unknown(),
  catalogs: z.array(z.unknown()).min(1),
  mode: z.enum(['draft', 'sealed']),
  deckStrategy: z.enum(['limited', 'catalog-coverage']).optional(),
  catalogTargetsPerDeck: z.number().int().min(1).max(16).optional(),
  seeds: z.array(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)).min(1).max(100),
  outputDirectory: z.string().trim().min(1),
  timeoutMs: z.number().int().min(1000).max(600_000),
  maximumTurns: z.number().int().positive().max(200),
  decisionBudget: z.number().int().positive().max(10_000),
});

export type PrintedObservedSweepOptions = z.infer<typeof OptionsSchema>;

export interface PrintedObservedBackendOwner {
  readonly backend: ObservedBackend;
  readonly dispose: () => void | Promise<void>;
}

export type PrintedObservedBackendFactory = (
  cardNames: ReadonlySet<string>,
  timeoutMs: number,
) => Promise<PrintedObservedBackendOwner>;

function deckRef(name: string, cards: readonly { readonly name: string }[]): DeckRef {
  const counts = new Map<string, number>();
  for (const card of cards) counts.set(card.name, (counts.get(card.name) ?? 0) + 1);
  return {
    name,
    cards: [...counts].map(([cardName, count]) => ({ name: cardName, count })),
  };
}

async function createInstalledOwner(
  cardNames: ReadonlySet<string>,
  timeoutMs: number,
): Promise<PrintedObservedBackendOwner> {
  const compiled = compileInstalledForgeBridge();
  if (compiled === null) throw new Error('Installed Forge is required for an observed printed sweep');
  try {
    const backend = installedForgeDiagnosticBackend(cardNames, {
      compiledBridgeClasses: compiled.classDirectory,
      timeoutMs,
    });
    if (backend === null) throw new Error('Installed Forge is required for an observed printed sweep');
    return { backend, dispose: compiled.dispose };
  } catch (cause) {
    compiled.dispose();
    throw cause;
  }
}

function safeDeckReport(deck: ReturnType<typeof samplePrintedLimitedDecks>[number]) {
  const { text, ...safe } = deck;
  return {
    ...safe,
    deckSha256: createHash('sha256').update(text).digest('hex'),
  };
}

function summaryOf(
  sessions: readonly { readonly status: string; readonly observed: ObservedDiagnosticSessionReport | null }[],
) {
  const opened = sessions.filter((session) => session.observed !== null).length;
  const finished = sessions.filter((session) => session.observed?.status === 'finished').length;
  return { requested: sessions.length, opened, finished, incomplete: sessions.length - finished };
}

function coveredCardNames(
  sessions: readonly { readonly observed: ObservedDiagnosticSessionReport | null }[],
  key: keyof ObservedDiagnosticSessionReport['cardCoverage'],
): readonly string[] {
  return [...new Set(sessions.flatMap((session) => session.observed?.cardCoverage[key] ?? []))].sort();
}

function coveredPrintingIds(
  sessions: readonly { readonly decks: readonly ReturnType<typeof safeDeckReport>[] }[],
  key: 'poolPrintingIds' | 'selectedPrintingIds',
): readonly string[] {
  return [...new Set(sessions.flatMap((session) => session.decks.flatMap((deck) => deck[key])))].sort();
}

/**
 * Runs sampled Limited decks without treating discovery as admission evidence.
 * The report intentionally excludes hands, libraries, and raw backend events.
 */
export async function runPrintedObservedSweep(
  input: PrintedObservedSweepOptions,
  createBackend: PrintedObservedBackendFactory = createInstalledOwner,
) {
  const options = OptionsSchema.parse(input);
  if (new Set(options.seeds).size !== options.seeds.length)
    throw new Error('Observed sweep seeds must be unique');
  const digest = async (text: string) => createHash('sha256').update(text).digest('hex');
  const prepared = await preparePrintedLimitedFormat(options.format, options.catalogs, digest);
  const catalogCards = options.catalogs.flatMap((catalog) => parsePrintedCardCatalog(catalog).cards);
  const catalogNames = new Set(catalogCards.map((card) => card.correctedName));
  const directory = resolve(options.outputDirectory);
  await mkdir(directory);
  const owner = await createBackend(catalogNames, options.timeoutMs);
  const sessions: {
    seed: number;
    status: string;
    decks: readonly ReturnType<typeof safeDeckReport>[];
    error: { readonly kind: string; readonly message: string } | null;
    observed: ObservedDiagnosticSessionReport | null;
  }[] = [];
  let uncoveredActionCardNames = new Set(catalogNames);
  const deckStrategy = options.deckStrategy ?? 'limited';
  const catalogCoveragePairs =
    deckStrategy === 'catalog-coverage'
      ? buildPrintedCatalogCoverageDeckPairs(options.catalogs, {
          ...(options.catalogTargetsPerDeck === undefined
            ? {}
            : { targetsPerDeck: options.catalogTargetsPerDeck }),
        })
      : [];

  try {
    for (const seed of options.seeds) {
      const decks =
        deckStrategy === 'catalog-coverage'
          ? catalogCoveragePairs[seed]
          : samplePrintedLimitedDecks(prepared, options.mode, seed);
      if (decks === undefined)
        throw new Error(
          `Catalog coverage deck index ${String(seed)} is outside 0..${String(catalogCoveragePairs.length - 1)}`,
        );
      const table: SessionSpec = {
        content: { kind: 'printed', format: prepared.format.id },
        seats: [
          { name: 'Local', controller: 'local', deck: deckRef(decks[0].file, decks[0].cards) },
          { name: 'Native', controller: 'engine', deck: deckRef(decks[1].file, decks[1].cards) },
        ],
        seed: `printed-observed-sweep/v1/${options.mode}/${String(seed)}`,
        maximumTurns: options.maximumTurns,
      };
      const opened = await owner.backend.open(table);
      if (!opened.ok) {
        sessions.push({
          seed,
          status: 'open-failed',
          decks: decks.map(safeDeckReport),
          error: { kind: opened.error.kind, message: opened.error.message },
          observed: null,
        });
        continue;
      }
      const observed = await runObservedDiagnosticSession(opened.session, {
        seed: table.seed!,
        decisionBudget: options.decisionBudget,
        preferredActionCardNames: uncoveredActionCardNames,
      });
      uncoveredActionCardNames = new Set(
        [...uncoveredActionCardNames].filter((name) => !observed.cardCoverage.selectedActions.includes(name)),
      );
      sessions.push({
        seed,
        status: observed.status,
        decks: decks.map(safeDeckReport),
        error: observed.error,
        observed,
      });
    }

    const callbackCounts: Record<string, number> = {};
    for (const session of sessions) {
      for (const [kind, count] of Object.entries(session.observed?.callbackCounts ?? {}))
        callbackCounts[kind] = (callbackCounts[kind] ?? 0) + count;
    }
    const poolPrintingIds = coveredPrintingIds(sessions, 'poolPrintingIds');
    const deckPrintingIds = coveredPrintingIds(sessions, 'selectedPrintingIds');
    const result = {
      schemaVersion: 1 as const,
      kind: 'printed-observed-sweep' as const,
      qualification: 'unproven' as const,
      admission: 'unchanged' as const,
      policy:
        deckStrategy === 'catalog-coverage'
          ? ('adapter-declared-enumerated-catalog-coverage-directed/v1' as const)
          : ('adapter-declared-enumerated-coverage-directed/v1' as const),
      deckStrategy,
      ...(deckStrategy === 'catalog-coverage'
        ? { catalogTargetsPerDeck: options.catalogTargetsPerDeck ?? 8 }
        : {}),
      formatId: prepared.format.id,
      formatFingerprint: prepared.fingerprint,
      formatSha256: prepared.format.contentSha256,
      catalogs: prepared.format.sources,
      mode: options.mode,
      seeds: options.seeds,
      bounds: { maximumTurns: options.maximumTurns, decisionBudget: options.decisionBudget },
      sessions,
      callbackCounts,
      coverage: {
        catalogPrintings: catalogCards.length,
        catalogNames: catalogNames.size,
        uniquePoolPrintings: poolPrintingIds.length,
        uniqueDeckPrintings: deckPrintingIds.length,
        poolPrintingIds,
        deckPrintingIds,
        observedCardNames: coveredCardNames(sessions, 'observed'),
        offeredActionCardNames: coveredCardNames(sessions, 'offeredActions'),
        selectedActionCardNames: coveredCardNames(sessions, 'selectedActions'),
      },
      summary: summaryOf(sessions),
    };
    await writeFile(join(directory, 'report.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
    return result;
  } finally {
    await owner.backend.shutdown?.();
    await owner.dispose();
  }
}
