/**
 * A staged constructed format, checked the way the Limited loader checks a
 * booster one: every source catalog present, hashed to what the format binds,
 * and every deck slot a printing one of them carries. No pack is prepared
 * because there is none; what a surface gets is the decks and a map from
 * printing to catalog entry.
 */
import {
  checkStandardDeck,
  parseCommanderHeadToHeadResults,
  parsePrintedCardCatalog,
  parsePrintedConstructedFormat,
  parsePrintedDeckWinRates,
  parsePrintedTokenPrintings,
  parsePrintedPresentationCatalog,
  serializedPrintedCardCatalogContent,
  serializedPrintedConstructedFormatContent,
  validatePrintedDisplayMetadata,
} from '@mtg/printed-card';
import { z } from 'zod';
import type {
  CommanderHeadToHeadResults,
  PrintedCardCatalog,
  PrintedCardCatalogEntry,
  PrintedConstructedFormat,
  PrintedDeckWinRates,
  PrintedRarity,
  PrintedTokenPrinting,
  PrintedCardPresentation,
} from '@mtg/printed-card';
import { sha256Text } from '../routes/analysis/calibration-read';
import { PrintedFormatRowSchema } from './printed-format';
import type { PrintedFormatRow } from './printed-format';

const PrintedConstructedAdmissionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  formatId: z.string().trim().min(1),
  cards: z
    .array(z.string().trim().min(1))
    .min(1)
    .refine((cards) => new Set(cards).size === cards.length),
});

export interface LoadedPrintedConstructedFormat {
  readonly availability: PrintedFormatRow['availability'];
  readonly format: PrintedConstructedFormat;
  readonly catalogs: readonly { readonly code: string; readonly catalog: PrintedCardCatalog }[];
  readonly rarities: Readonly<Record<string, PrintedRarity>>;
  /** Every printing a deck names, by physical id. */
  readonly printings: ReadonlyMap<string, PrintedCardCatalogEntry>;
  /** The format's token printings, empty when none are staged. */
  readonly tokens: readonly PrintedTokenPrinting[];
  readonly presentations?: readonly PrintedCardPresentation[];
  readonly winRates?: PrintedDeckWinRates;
  readonly headToHead?: CommanderHeadToHeadResults;
}

function checkedDeckWinRates(input: unknown, format: PrintedConstructedFormat): PrintedDeckWinRates {
  const table = parsePrintedDeckWinRates(input);
  const carried = new Set(format.decks.map((deck) => deck.id));
  for (const row of table.decks) {
    if (row.deckId === undefined || !carried.has(row.deckId)) {
      throw new Error(
        `Printed format ${format.id} was staged a win rate for ${row.name}, a deck ${format.id} does not carry`,
      );
    }
  }
  return table;
}

function checkedHeadToHead(input: unknown, format: PrintedConstructedFormat): CommanderHeadToHeadResults {
  const table = parseCommanderHeadToHeadResults(input);
  const carried = new Set(format.decks.map((deck) => deck.id));
  for (const pairing of table.pairings) {
    if (!carried.has(pairing.a) || !carried.has(pairing.b)) {
      throw new Error(
        `Printed format ${format.id} was staged a head-to-head pairing for a deck it does not carry`,
      );
    }
  }
  return table;
}

/** The format against its catalogs: checksums first, then every slot resolved. */
export async function checkPrintedConstructedBundle(
  formatInput: unknown,
  catalogs: readonly PrintedCardCatalog[],
  digest: (text: string) => Promise<string>,
  admissionInput?: unknown,
): Promise<{
  readonly format: PrintedConstructedFormat;
  readonly printings: Map<string, PrintedCardCatalogEntry>;
}> {
  const format = parsePrintedConstructedFormat(formatInput);
  if ((await digest(serializedPrintedConstructedFormatContent(format))) !== format.contentSha256) {
    throw new Error(`constructed format ${format.id} checksum mismatch`);
  }
  const byFormat = new Map(catalogs.map((catalog) => [catalog.format, catalog]));
  if (byFormat.size !== catalogs.length) throw new Error('duplicate printed catalog');
  for (const source of format.sources) {
    const catalog = byFormat.get(source.catalogFormat);
    if (catalog === undefined) throw new Error(`missing source catalog ${source.code}`);
    if (
      catalog.contentSha256 !== source.catalogSha256 ||
      (await digest(serializedPrintedCardCatalogContent(catalog))) !== source.catalogSha256
    ) {
      throw new Error(`source catalog ${source.code} checksum mismatch`);
    }
  }
  if (catalogs.length !== format.sources.length) throw new Error('unexpected extra source catalog');
  const entries = new Map(
    catalogs.flatMap((catalog) => catalog.cards.map((card) => [card.physicalId, card])),
  );
  const printings = new Map<string, PrintedCardCatalogEntry>();
  const admission =
    admissionInput === undefined ? undefined : PrintedConstructedAdmissionSchema.parse(admissionInput);
  if (admission !== undefined && admission.formatId !== format.id) {
    throw new Error(`constructed admission names ${admission.formatId}, not ${format.id}`);
  }
  const admitted = admission === undefined ? undefined : new Set(admission.cards);
  for (const deck of format.decks) {
    for (const slot of [...deck.commanders, ...deck.cards]) {
      const entry = entries.get(slot.physicalId);
      if (entry === undefined)
        throw new Error(`deck ${deck.id} names a printing no catalog carries: ${slot.name}`);
      if (entry.correctedName !== slot.name) {
        throw new Error(`deck ${deck.id} names ${slot.name} for a printing of ${entry.correctedName}`);
      }
      if (admitted !== undefined && !admitted.has(slot.physicalId)) {
        throw new Error(`deck ${deck.id} card ${slot.name} is not admitted for ${format.id}`);
      }
      printings.set(slot.physicalId, entry);
    }
  }
  return { format, printings };
}

/** Fetch is injected so transport failures remain distinct from artifact validation. */
export async function loadPrintedConstructedFormat(
  input: unknown,
  fetchJson: (url: string) => Promise<unknown>,
): Promise<LoadedPrintedConstructedFormat> {
  const row = PrintedFormatRowSchema.parse(input);
  const formatUrl = row.kind === 'constructed' ? row.formatUrl : row.constructedFormatUrl;
  if (formatUrl === undefined) throw new Error(`Printed format ${row.id} has no constructed decks`);
  const [formatInput, catalogs, admission] = await Promise.all([
    fetchJson(formatUrl),
    Promise.all(
      row.catalogs.map(async (source) => ({
        code: source.code,
        catalog: parsePrintedCardCatalog(await fetchJson(source.url)),
      })),
    ),
    row.kind === 'constructed' ? undefined : fetchJson(row.constructedAdmissionUrl!),
  ]);
  const { format, printings } = await checkPrintedConstructedBundle(
    formatInput,
    catalogs.map((source) => source.catalog),
    sha256Text,
    admission,
  );
  if (format.id !== row.id || format.name !== row.name) {
    throw new Error('Printed format index identity does not match its recipe');
  }
  for (const source of format.sources) {
    if (
      !catalogs.some((entry) => entry.code === source.code && entry.catalog.format === source.catalogFormat)
    ) {
      throw new Error(`Printed format index source ${source.code} does not match its catalog`);
    }
  }
  if (row.kind === 'constructed') {
    if (format.rules.variant !== 'commander' && format.rules.variant !== 'momir') {
      throw new Error(`standalone constructed format ${row.id} requires Commander or Momir rules`);
    }
  } else {
    if (format.rules.variant !== 'standard' || format.rules.startingLife !== 20) {
      throw new Error(`Printed format ${row.id} constructed decks require Standard rules at 20 life`);
    }
    for (const deck of format.decks) {
      const verdict = checkStandardDeck(deck, printings);
      if (!verdict.legal) {
        throw new Error(
          `deck ${deck.id} is not a legal Standard deck: ${verdict.findings.map((finding) => finding.detail).join('; ')}`,
        );
      }
    }
  }
  const display =
    row.displayMetadataUrl === undefined
      ? undefined
      : validatePrintedDisplayMetadata(
          await fetchJson(row.displayMetadataUrl),
          catalogs.map((source) => source.catalog),
        );
  const rarities = Object.fromEntries(
    display?.catalogs.flatMap((source) => Object.entries(source.rarities)) ?? [],
  );
  const tokens =
    row.tokenPrintingsUrl === undefined
      ? []
      : parsePrintedTokenPrintings(await fetchJson(row.tokenPrintingsUrl)).tokens;
  const presentations =
    row.presentationCatalogUrl === undefined
      ? []
      : parsePrintedPresentationCatalog(await fetchJson(row.presentationCatalogUrl)).cards;
  const winRates =
    row.deckWinRatesUrl === undefined
      ? undefined
      : checkedDeckWinRates(await fetchJson(row.deckWinRatesUrl), format);
  const headToHead =
    row.headToHeadUrl === undefined
      ? undefined
      : checkedHeadToHead(await fetchJson(row.headToHeadUrl), format);
  return {
    availability: row.availability,
    format,
    catalogs,
    rarities,
    printings,
    tokens,
    presentations,
    ...(winRates === undefined ? {} : { winRates }),
    ...(headToHead === undefined ? {} : { headToHead }),
  };
}
