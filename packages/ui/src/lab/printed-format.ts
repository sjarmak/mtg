/** Browser-safe bundle registry. Catalog availability never grants Forge admission. */
import { z } from 'zod';
import {
  parsePrintedCardCatalog,
  parsePrintedTokenPrintings,
  validatePrintedDisplayMetadata,
} from '@mtg/printed-card';
import type { PrintedRarity, PrintedTokenPrinting } from '@mtg/printed-card';
import type { PrintedCardCatalog } from '@mtg/printed-card';
import { preparePrintedLimitedFormat, validatePrintedCardRoles } from '@mtg/draft-export';
import type { PreparedPrintedLimitedFormat, PrintedCardRoles } from '@mtg/draft-export';
import { sha256Text } from '../routes/analysis/calibration-read';
import { validatePrintedDraftRatings } from './printed-draft-ratings';
import type { PrintedDraftRatings } from './printed-draft-ratings';

export const PRINTED_FORMAT_INDEX_URL = 'formats/index.json';
const LocalJsonPath = z
  .string()
  .regex(/^(?:[a-z0-9][a-z0-9_-]*\/)*[a-z0-9][a-z0-9_-]*\.json$/, 'expected a local JSON resource path');
export const PrintedFormatAvailabilitySchema = z.strictObject({
  browse: z.literal('available'),
  draft: z.enum(['available', 'unavailable']),
  sealed: z.enum(['available', 'unavailable']),
  play: z.strictObject({
    status: z.enum(['unavailable', 'experimental', 'supported']),
    reason: z.string().trim().min(1),
  }),
});
export const PrintedFormatRowSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    name: z.string().min(1),
    /**
     * What the format file holds: `limited` is a booster recipe with products
     * to draft and open, `constructed` a list of fixed decks (a Commander
     * precon) with no packs. Absent on an index staged before the second kind
     * existed, which reads as `limited`.
     */
    kind: z.enum(['limited', 'constructed']).optional(),
    variant: z.enum(['commander', 'momir']).optional(),
    availability: PrintedFormatAvailabilitySchema,
    releaseDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .optional(),
    formatUrl: LocalJsonPath,
    constructedFormatUrl: LocalJsonPath.optional(),
    constructedAdmissionUrl: LocalJsonPath.optional(),
    displayMetadataUrl: LocalJsonPath.optional(),
    /**
     * Official printings of the tokens the format's cards create, each bound
     * to the engine's own name for it, so an observed Pegasus Token draws the
     * Starter Commander Pegasus rather than a blank frame. Presentation only:
     * a token is neither admitted nor dealt, so this binds to no admission.
     */
    tokenPrintingsUrl: LocalJsonPath.optional(),
    presentationCatalogUrl: LocalJsonPath.optional(),
    draftRatingsUrl: LocalJsonPath.optional(),
    /** Issue 305: model-labeled card roles; read only by role-aware bot policies. */
    cardRolesUrl: LocalJsonPath.optional(),
    deckWinRatesUrl: LocalJsonPath.optional(),
    headToHeadUrl: LocalJsonPath.optional(),
    catalogs: z
      .array(
        z.object({
          code: z.string().regex(/^[A-Z0-9]+$/),
          name: z.string().min(1).optional(),
          url: LocalJsonPath,
          /**
           * What the set is to the format: a `product` is a set whose packs a
           * product opens (Amonkhet, Hour of Devastation), a `supplement` rides
           * inside another set's packs and no product opens it (the Invocations).
           * Derived at staging time from the format's products; absent on an
           * index staged before the field existed, which reads as `product`.
           */
          role: z.enum(['product', 'supplement']).optional(),
        }),
      )
      .min(1),
  })
  .superRefine((row, context) => {
    if (new Set(row.catalogs.map((catalog) => catalog.code)).size !== row.catalogs.length) {
      context.addIssue({ code: 'custom', message: 'duplicate printed source code' });
    }
    if (row.kind !== 'constructed' && row.deckWinRatesUrl !== undefined) {
      context.addIssue({ code: 'custom', message: 'deck win rates belong to a constructed format' });
    }
    if (row.kind !== 'constructed' && row.headToHeadUrl !== undefined) {
      context.addIssue({ code: 'custom', message: 'head-to-head results belong to a constructed format' });
    }
    if ((row.constructedFormatUrl === undefined) !== (row.constructedAdmissionUrl === undefined)) {
      context.addIssue({ code: 'custom', message: 'constructed sidecar requires its admission cards' });
    }
    if (row.kind === 'constructed' && row.constructedFormatUrl !== undefined) {
      context.addIssue({ code: 'custom', message: 'constructed format cannot carry a constructed sidecar' });
    }
    if (row.kind === 'constructed' && row.variant === undefined) {
      context.addIssue({ code: 'custom', message: 'constructed format requires its rules variant' });
    }
    if (row.kind !== 'constructed' && row.variant !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'limited format cannot carry a constructed rules variant',
      });
    }
  });
export const PrintedFormatIndexSchema = z
  .object({
    schemaVersion: z.literal(2),
    formats: z.array(PrintedFormatRowSchema),
  })
  .superRefine((index, context) => {
    if (new Set(index.formats.map((format) => format.id)).size !== index.formats.length) {
      context.addIssue({ code: 'custom', message: 'duplicate printed format identity' });
    }
  });
export type PrintedFormatRow = z.infer<typeof PrintedFormatRowSchema>;
export type PrintedFormatIndex = z.infer<typeof PrintedFormatIndexSchema>;
export interface LoadedPrintedFormat {
  readonly availability: PrintedFormatRow['availability'];
  readonly rarities: Readonly<Record<string, PrintedRarity>>;
  readonly draftRatings?: PrintedDraftRatings;
  readonly cardRoles?: PrintedCardRoles;
  readonly prepared: PreparedPrintedLimitedFormat;
  /** The format's token printings, empty when none are staged. */
  readonly tokens: readonly PrintedTokenPrinting[];
  readonly catalogs: readonly { readonly code: string; readonly catalog: PrintedCardCatalog }[];
}

/** Fetch is injected so transport failures remain distinct from artifact validation. */
export async function loadPrintedFormat(
  input: unknown,
  fetchJson: (url: string) => Promise<unknown>,
): Promise<LoadedPrintedFormat> {
  const row = PrintedFormatRowSchema.parse(input);
  if (row.kind === 'constructed') {
    throw new Error(
      `Printed format ${row.id} is a constructed format with no packs to prepare; load it through loadPrintedConstructedFormat`,
    );
  }
  const [format, catalogs] = await Promise.all([
    fetchJson(row.formatUrl),
    Promise.all(
      row.catalogs.map(async (source) => ({
        code: source.code,
        catalog: parsePrintedCardCatalog(await fetchJson(source.url)),
      })),
    ),
  ]);
  const prepared = await preparePrintedLimitedFormat(
    format,
    catalogs.map((source) => source.catalog),
    sha256Text,
  );
  if (prepared.format.id !== row.id || prepared.format.name !== row.name) {
    throw new Error('Printed format index identity does not match its recipe');
  }
  for (const source of prepared.format.sources) {
    if (
      !catalogs.some((entry) => entry.code === source.code && entry.catalog.format === source.catalogFormat)
    ) {
      throw new Error(`Printed format index source ${source.code} does not match its catalog`);
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
  const draftRatings =
    row.draftRatingsUrl === undefined
      ? undefined
      : await validatePrintedDraftRatings(await fetchJson(row.draftRatingsUrl), prepared, catalogs);
  const cardRoles =
    row.cardRolesUrl === undefined
      ? undefined
      : validatePrintedCardRoles(await fetchJson(row.cardRolesUrl), catalogs);
  const tokens = await loadTokenPrintings(row, fetchJson);
  return {
    availability: row.availability,
    prepared,
    catalogs,
    rarities,
    tokens,
    ...(draftRatings === undefined ? {} : { draftRatings }),
    ...(cardRoles === undefined ? {} : { cardRoles }),
  };
}

/** The staged token printings, or none; a row staged before the field existed has none. */
export async function loadTokenPrintings(
  row: Pick<PrintedFormatRow, 'tokenPrintingsUrl'>,
  fetchJson: (url: string) => Promise<unknown>,
): Promise<readonly PrintedTokenPrinting[]> {
  return row.tokenPrintingsUrl === undefined
    ? []
    : parsePrintedTokenPrintings(await fetchJson(row.tokenPrintingsUrl)).tokens;
}
