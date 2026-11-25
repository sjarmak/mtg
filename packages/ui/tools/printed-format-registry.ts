/** Trusted launcher configuration; browser discovery remains the separately staged index. */
import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { PrintedFormatAvailabilitySchema } from '../src/lab/printed-format';
import type { PrintedFormatSource } from './stage-printed-formats';

const Filename = z.string().regex(/^[a-z0-9][a-z0-9_-]*\.json$/u, 'expected a JSON filename');
const DirectoryName = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/u, 'expected a directory name');
const RegistrySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    formats: z.array(
      z.strictObject({
        id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/u),
        formatFile: Filename,
        constructedFormatFile: Filename.optional(),
        displayMetadataFile: Filename.optional(),
        /** Official token printings the format's cards create, bound to Forge's names (`fetch-token-printings.ts`). */
        tokenPrintingsFile: Filename.optional(),
        presentationCatalog: z.literal('momir-oldest-creatures').optional(),
        admissionDirectory: DirectoryName.optional(),
        availability: PrintedFormatAvailabilitySchema,
        catalogs: z
          .array(
            z.strictObject({
              code: z.string().regex(/^[A-Z0-9]+$/u),
              name: z.string().trim().min(1).optional(),
              file: Filename,
            }),
          )
          .min(1),
      }),
    ),
  })
  .superRefine((registry, context) => {
    if (new Set(registry.formats.map((format) => format.id)).size !== registry.formats.length)
      context.addIssue({ code: 'custom', message: 'duplicate printed format identity' });
    for (const format of registry.formats) {
      if (new Set(format.catalogs.map((catalog) => catalog.code)).size !== format.catalogs.length)
        context.addIssue({ code: 'custom', message: `duplicate catalog code in ${format.id}` });
      if (format.availability.play.status === 'supported' && format.admissionDirectory === undefined)
        context.addIssue({ code: 'custom', message: `supported play requires admission in ${format.id}` });
      if (format.availability.play.status !== 'supported' && format.admissionDirectory !== undefined)
        context.addIssue({
          code: 'custom',
          message: `inactive play cannot install admission in ${format.id}`,
        });
    }
  });

export function parsePrintedFormatRegistry(repoRoot: string, input: unknown): readonly PrintedFormatSource[] {
  return RegistrySchema.parse(input).formats.map(
    ({
      id,
      constructedFormatFile,
      displayMetadataFile,
      tokenPrintingsFile,
      presentationCatalog,
      admissionDirectory,
      ...format
    }) => ({
      ...format,
      id,
      catalogs: format.catalogs.map(({ name, ...catalog }) => ({
        ...catalog,
        ...(name === undefined ? {} : { name }),
      })),
      ...(constructedFormatFile === undefined ? {} : { constructedFormatFile }),
      ...(displayMetadataFile === undefined ? {} : { displayMetadataFile }),
      ...(tokenPrintingsFile === undefined ? {} : { tokenPrintingsFile }),
      ...(presentationCatalog === undefined ? {} : { presentationCatalog }),
      directory: resolve(repoRoot, 'packages', 'data', 'data', id),
      ...(admissionDirectory === undefined
        ? {}
        : {
            admissionDirectory: resolve(repoRoot, 'packages', 'data', 'data', id, admissionDirectory),
          }),
    }),
  );
}

/**
 * The formats this checkout can stage, given whether the card store is here.
 *
 * A presentation catalog is built from `data/store/mtg.sqlite` at staging
 * time, and the store is a local ingest that a fresh clone does not have. A
 * format that needs one is left out of the index rather than failing the
 * launcher, so `npm run play` still reaches every set the checkout can run.
 */
export function stageableFormats(
  formats: readonly PrintedFormatSource[],
  storePresent: boolean,
): { readonly kept: readonly PrintedFormatSource[]; readonly skipped: readonly string[] } {
  if (storePresent) return { kept: formats, skipped: [] };
  return {
    kept: formats.filter((format) => format.presentationCatalog === undefined),
    skipped: formats.filter((format) => format.presentationCatalog !== undefined).map((format) => format.id),
  };
}

export function loadPrintedAdmissionSource(source: PrintedFormatSource) {
  if (source.admissionDirectory === undefined) return undefined;
  const root = resolve(source.admissionDirectory);
  const readEvidence = (relativePath: string): Buffer => {
    if (
      !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/u.test(relativePath) ||
      relativePath.split('/').some((part) => part === '.' || part === '..')
    ) {
      throw new Error(`Invalid installed admission path: ${relativePath}`);
    }
    const path = resolve(root, relativePath);
    if (!path.startsWith(`${root}${sep}`))
      throw new Error(`Installed admission escapes root: ${relativePath}`);
    return readFileSync(path);
  };
  return {
    formatId: source.id,
    format: JSON.parse(readFileSync(join(source.directory, source.formatFile), 'utf8')) as unknown,
    catalogs: source.catalogs.map(
      (catalog) => JSON.parse(readFileSync(join(source.directory, catalog.file), 'utf8')) as unknown,
    ),
    evidence: {
      body: readFileSync(join(root, 'admission.json'), 'utf8'),
      read: readEvidence,
    },
  };
}

/**
 * Every installed admission the registry names, read from the checkout.
 *
 * The one loader behind both launchers. `npm run backend` started the gateway
 * with no printed admissions at all, so a page attached to it through
 * `MTG_BACKEND_GATEWAY_PORT` read "admission is installed" off the files the
 * play launcher staged and was then refused `route-missing` by a gateway that
 * had never been asked to route the format; the two disagreed because they
 * read the registry through two different paths, one of which was nothing.
 */
export function installedPrintedAdmissions(repoRoot: string): {
  readonly formats: readonly PrintedFormatSource[];
  readonly admissions: readonly NonNullable<ReturnType<typeof loadPrintedAdmissionSource>>[];
} {
  const registry = JSON.parse(
    readFileSync(join(repoRoot, 'packages', 'data', 'data', 'printed-formats-v1.json'), 'utf8'),
  ) as unknown;
  const formats = parsePrintedFormatRegistry(repoRoot, registry);
  return {
    formats,
    admissions: formats.map(loadPrintedAdmissionSource).filter((admission) => admission !== undefined),
  };
}
