/** Printed recipes reuse the weighted sampler and physical replay, never the DSL card model. */
import { collatedBoosterSize, openCollatedPool, withoutBasicLandIds } from '@mtg/deckbuild';
import type { BasicLandRemoval, PackCollation, SealedPool, SheetSlot } from '@mtg/deckbuild';
import {
  parsePrintedCardCatalog,
  parsePrintedLimitedFormat,
  PrintedDraftTranscriptSchema,
  serializedPrintedCardCatalogContent,
  serializedPrintedLimitedFormatContent,
} from '@mtg/printed-card';
import type {
  PrintedBoosterProduct,
  PrintedCardCatalog,
  PrintedCardCatalogEntry,
  PrintedLimitedFormat,
} from '@mtg/printed-card';
import { DraftError } from './errors';
import type { DraftEvidenceRequest } from './draft-evidence';
import { runPhysicalPackDraft } from './physical-cube-draft';
import type {
  PhysicalCubeCard,
  PhysicalCubeChoose,
  PhysicalCubePack,
  PhysicalCubeDraftProgress,
  PhysicalCubeScore,
} from './physical-cube-draft';

/** Copy-specific provenance wraps the existing printing, rather than rewriting its catalog identity. */
export interface PrintedBoosterPayload {
  readonly printing: PrintedCardCatalogEntry;
  readonly sourceSetCode: string;
  readonly productId: string;
  readonly slot: SheetSlot;
}
export type PrintedBoosterCopy = PhysicalCubeCard<PrintedBoosterPayload>;

export interface PreparedPrintedLimitedFormat {
  readonly format: PrintedLimitedFormat;
  readonly fingerprint: string;
  readonly basicLandRemoval: Readonly<Record<string, BasicLandRemoval>>;
  readonly openDraftPacks: (seed: string) => readonly PhysicalCubePack<PrintedBoosterPayload>[];
  readonly openSealedPool: (seed: string) => SealedPool<PrintedBoosterCopy>;
}

interface SourcePrinting {
  readonly id: string;
  readonly printing: PrintedCardCatalogEntry;
  readonly sourceSetCode: string;
}
interface PreparedProduct {
  readonly product: PrintedBoosterProduct;
  readonly cards: readonly SourcePrinting[];
  readonly collation: PackCollation;
  readonly removal: BasicLandRemoval;
}

export type PrintedTextDigest = (text: string) => Promise<string>;
// Bump when deterministic sampling, copy naming, or replay semantics change.
const REPLAY_VERSION = 'printed-sheets-physical-replay/v2';

const colorsOf = (card: SourcePrinting): readonly string[] => card.printing.colors;

async function verifiedCatalogs(
  format: PrintedLimitedFormat,
  inputs: readonly unknown[],
  digest: PrintedTextDigest,
): Promise<ReadonlyMap<string, PrintedCardCatalog>> {
  const catalogs = inputs.map(parsePrintedCardCatalog);
  const byFormat = new Map(catalogs.map((catalog) => [catalog.format, catalog]));
  if (byFormat.size !== catalogs.length) throw new DraftError('duplicate printed catalog');
  for (const source of format.sources) {
    const catalog = byFormat.get(source.catalogFormat);
    if (catalog === undefined) throw new DraftError(`missing source catalog ${source.code}`);
    if (
      catalog.contentSha256 !== source.catalogSha256 ||
      (await digest(serializedPrintedCardCatalogContent(catalog))) !== source.catalogSha256
    ) {
      throw new DraftError(`source catalog ${source.code} checksum mismatch`);
    }
  }
  if (catalogs.length !== format.sources.length) throw new DraftError('unexpected extra source catalog');
  return byFormat;
}

function prepareProduct(
  product: PrintedBoosterProduct,
  format: PrintedLimitedFormat,
  catalogs: ReadonlyMap<string, PrintedCardCatalog>,
): PreparedProduct {
  const cards = format.sources
    .filter((source) => product.sourceSetCodes.includes(source.code))
    .flatMap((source) => {
      const catalog = catalogs.get(source.catalogFormat);
      if (catalog === undefined) throw new DraftError(`missing source catalog ${source.code}`);
      return catalog.cards.map((printing) => ({
        id: printing.physicalId,
        printing,
        sourceSetCode: source.code,
      }));
    });
  // Validate the complete source first: no-basics must not hide broken or missing foreign sheets.
  openCollatedPool(cards, product.collation, { seed: 'printed/source-validation', boosters: 1, colorsOf });
  const basics = new Set(
    cards
      .filter(
        ({ printing }) =>
          format.basicLandPolicy === 'remove' &&
          printing.typeLine.split(' — ')[0]?.split(' ').includes('Basic'),
      )
      .map((card) => card.id),
  );
  const [collation, removal] = withoutBasicLandIds(product.collation, basics);
  if (removal.unfillableBoosters > 0)
    throw new DraftError(`basic-land removal makes ${product.id} configurations unfillable`);
  openCollatedPool(cards, collation, { seed: 'printed/dealt-validation', boosters: 1, colorsOf });
  return { product, cards, collation, removal };
}

function openProduct(
  product: PreparedProduct,
  fingerprint: string,
  seed: string,
  mode: 'draft' | 'sealed',
  packIndex: number,
): readonly PrintedBoosterCopy[] {
  if (seed.trim().length === 0) throw new DraftError('printed Limited seed must not be empty');
  const stream = JSON.stringify([REPLAY_VERSION, fingerprint, seed, mode, packIndex, product.product.id]);
  const opened = openCollatedPool(product.cards, product.collation, { seed: stream, boosters: 1, colorsOf });
  const provenance = opened.provenance;
  if (provenance.kind !== 'sheets') throw new DraftError('printed booster lost sheet provenance');
  return opened.cards.map((card, index) => {
    const slot = provenance.slots[0]?.[index];
    if (slot === undefined) throw new DraftError('printed booster lost slot provenance');
    return {
      physicalId: `printed-copy:${mode}:${String(packIndex)}:${String(index)}:${card.id}`,
      payload: {
        printing: card.printing,
        sourceSetCode: card.sourceSetCode,
        productId: product.product.id,
        slot,
      },
    };
  });
}

/** Verify source bytes before exposing any opener; digest is Node crypto or the browser's existing adapter. */
export async function preparePrintedLimitedFormat(
  input: unknown,
  catalogInputs: readonly unknown[],
  digest: PrintedTextDigest,
): Promise<PreparedPrintedLimitedFormat> {
  const format = parsePrintedLimitedFormat(input);
  if ((await digest(serializedPrintedLimitedFormatContent(format))) !== format.contentSha256) {
    throw new DraftError('printed Limited format checksum mismatch');
  }
  const catalogs = await verifiedCatalogs(format, catalogInputs, digest);
  const products = new Map(
    format.products.map((product) => [product.id, prepareProduct(product, format, catalogs)]),
  );
  const fingerprint = await digest(JSON.stringify({ version: REPLAY_VERSION, format: format.contentSha256 }));
  const productFor = (id: string): PreparedProduct => {
    const product = products.get(id);
    if (product === undefined) throw new DraftError(`unknown product ${id}`);
    return product;
  };
  const sizes = new Set(
    format.draft.rounds.flatMap((id) => productFor(id).collation.boosters.map(collatedBoosterSize)),
  );
  if (sizes.size !== 1)
    throw new DraftError('printed draft requires equal-sized booster configurations across rounds');
  return {
    format,
    fingerprint,
    basicLandRemoval: Object.fromEntries([...products].map(([id, product]) => [id, product.removal])),
    openDraftPacks: (seed) =>
      format.draft.rounds.flatMap((id, roundIndex) =>
        Array.from({ length: format.draft.seats }, (_unused, seatIndex) => ({
          round: roundIndex + 1,
          openedBy: `seat-${String(seatIndex + 1)}`,
          cards: openProduct(
            productFor(id),
            fingerprint,
            seed,
            'draft',
            roundIndex * format.draft.seats + seatIndex,
          ),
        })),
      ),
    openSealedPool: (seed) => {
      const boosters = format.sealed.boosters.map((id, index) =>
        openProduct(productFor(id), fingerprint, seed, 'sealed', index),
      );
      return {
        seed,
        boosters,
        cards: boosters.flat(),
        provenance: { kind: 'sheets', slots: boosters.map((pack) => pack.map((card) => card.payload.slot)) },
      };
    },
  };
}

export interface PrintedLimitedDraftOptions {
  readonly seed: string;
  readonly botPolicy: string;
  readonly score: PhysicalCubeScore<PrintedBoosterPayload>;
  readonly choose?: PhysicalCubeChoose<PrintedBoosterPayload>;
  /** Collect automated-seat choices under this printed format and bot policy. */
  readonly evidence?: DraftEvidenceRequest | null;
  readonly humanSeatIds?: readonly string[];
  readonly picks?: Readonly<Record<string, readonly string[]>>;
}

/** Internal engine progress. Player/advisor consumers must project only their own observations and picks. */
export function runPrintedLimitedDraft(
  prepared: PreparedPrintedLimitedFormat,
  options: PrintedLimitedDraftOptions,
): PhysicalCubeDraftProgress<PrintedBoosterPayload> {
  if (options.botPolicy.trim().length === 0) throw new DraftError('printed draft bot policy is empty');
  if (options.evidence !== undefined && options.evidence !== null) {
    if (
      options.evidence.subject.formatId !== prepared.format.id ||
      options.evidence.subject.formatSha256 !== prepared.format.contentSha256
    ) {
      throw new DraftError('printed draft evidence format provenance does not match the prepared format');
    }
    if (options.evidence.behavior.policyId !== options.botPolicy) {
      throw new DraftError('printed draft evidence policy does not match the bot policy');
    }
  }
  return runPhysicalPackDraft(prepared.openDraftPacks(options.seed), {
    ...options,
    seatIds: Array.from(
      { length: prepared.format.draft.seats },
      (_unused, index) => `seat-${String(index + 1)}`,
    ),
  });
}

export function resumePrintedLimitedDraft(
  prepared: PreparedPrintedLimitedFormat,
  input: unknown,
  bot: Pick<PrintedLimitedDraftOptions, 'score' | 'botPolicy'> &
    Partial<Pick<PrintedLimitedDraftOptions, 'choose'>>,
): PhysicalCubeDraftProgress<PrintedBoosterPayload> {
  const transcript = PrintedDraftTranscriptSchema.parse(input);
  if (transcript.formatId !== prepared.format.id || transcript.fingerprint !== prepared.fingerprint) {
    throw new DraftError(
      'printed draft format fingerprint mismatch; this transcript belongs to another recipe or source revision',
    );
  }
  if ((transcript.botPolicy ?? prepared.format.draft.botPolicy) !== bot.botPolicy)
    throw new DraftError('printed draft bot policy mismatch');
  return runPrintedLimitedDraft(prepared, { ...transcript, ...bot });
}
