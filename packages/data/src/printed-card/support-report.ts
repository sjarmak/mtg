/** Compose existing catalog, script inventory and admission contracts for offline review. */
import {
  buildPrintedSupportReport,
  parsePrintedCardCatalog,
  parsePrintedLimitedFormat,
  PrintedPlaySubjectSchema,
} from '@mtg/printed-card';
import { verifyPrintedLimitedPlayAdmission } from '@mtg/printed-card/node';
import { buildPrintedScriptInventory } from './script-inventory';

export interface PrintedFormatSupportInputs {
  readonly admission: string;
  readonly format: unknown;
  readonly catalogs: readonly unknown[];
  readonly measuredRuntime: unknown;
  readonly readEvidence: (relativePath: string) => string | Uint8Array;
  readonly readScript: (archiveMember: string) => string | Uint8Array;
}

/** No ability classification: literal script tokens remain navigation facts only. */
export function buildPrintedFormatSupportReport(input: PrintedFormatSupportInputs) {
  const { admission, readEvidence, readScript } = input;
  const format = parsePrintedLimitedFormat(input.format);
  const catalogs = input.catalogs.map(parsePrintedCardCatalog);
  const subject = PrintedPlaySubjectSchema.parse({
    ...PrintedPlaySubjectSchema.omit({ formatId: true, formatSha256: true, catalogs: true }).parse(
      input.measuredRuntime,
    ),
    formatId: format.id,
    formatSha256: format.contentSha256,
    catalogs: Object.fromEntries(format.sources.map((source) => [source.code, source.catalogSha256])),
  });
  verifyPrintedLimitedPlayAdmission(admission, format, catalogs, input.measuredRuntime, readEvidence);
  const report = buildPrintedSupportReport(
    JSON.parse(admission),
    subject,
    catalogs.flatMap((catalog) => catalog.cards.map((card) => card.physicalId)),
  );
  const inventory = buildPrintedScriptInventory(catalogs, readScript);
  const byId = new Map(inventory.cards.map((card) => [card.physicalId, card]));
  return {
    ...report,
    evidenceVerification: 'verified' as const,
    cards: report.cards.map((card) => {
      const entry = byId.get(card.physicalId)!;
      return {
        ...card,
        name: entry.name,
        catalogFormat: entry.catalogFormat,
        script: {
          path: entry.forgeScript,
          sha256: entry.forgeScriptSha256,
          keywords: entry.keywords,
          apis: entry.apis,
          triggerModes: entry.triggerModes,
        },
      };
    }),
  };
}
