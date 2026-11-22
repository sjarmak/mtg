/** Compose exact-script qualifications and fresh match probes into verified admission evidence. */
import { createHash, randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  PrintedPlayProbeReceiptSchema,
  PrintedPlaySubjectSchema,
  parsePrintedCardCatalog,
  parsePrintedFormat,
} from '@mtg/printed-card';
import {
  buildPrintedPlayAdmissionFromScriptQualifications,
  verifyPrintedFormatPlayAdmission,
} from '@mtg/printed-card/node';

const RelativePath = z
  .string()
  .regex(/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/u)
  .refine((path) => path.split('/').every((part) => part !== '.' && part !== '..'));
const QualificationManifest = z.object({
  qualifications: z.array(
    z.strictObject({
      sourceScript: z.strictObject({
        path: z.string().min(1),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      path: RelativePath,
    }),
  ),
  residualScripts: z.array(z.unknown()),
});
const ProbeProvenance = z.object({ subject: PrintedPlaySubjectSchema });
const digest = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

function readWithin(root: string, relativePath: string): Buffer {
  const checked = RelativePath.safeParse(relativePath);
  if (!checked.success) throw new Error(`Invalid evidence path: ${relativePath}`);
  const path = resolve(root, checked.data);
  if (!path.startsWith(`${root}${sep}`)) throw new Error(`Evidence path escapes bundle: ${relativePath}`);
  return readFileSync(path);
}

interface BuildOptions {
  readonly formatPath: string;
  readonly catalogPaths: readonly string[];
  readonly qualificationRoot: string;
  readonly matchProbeRoot: string;
  readonly outputRoot: string;
  readonly generatedObjectPolicy?: 'forge-momir-global-creatures';
}

export function buildScriptQualifiedAdmission(options: BuildOptions) {
  const outputRoot = resolve(options.outputRoot);
  if (existsSync(outputRoot)) throw new Error(`Output already exists: ${outputRoot}`);
  const qualificationRoot = resolve(options.qualificationRoot);
  const matchProbeRoot = resolve(options.matchProbeRoot);
  const format = parsePrintedFormat(JSON.parse(readFileSync(resolve(options.formatPath), 'utf8')));
  const catalogs = options.catalogPaths.map((path) =>
    parsePrintedCardCatalog(JSON.parse(readFileSync(resolve(path), 'utf8'))),
  );
  const manifest = QualificationManifest.parse(
    JSON.parse(readFileSync(join(qualificationRoot, 'manifest.json'), 'utf8')),
  );
  if (manifest.residualScripts.length !== 0) {
    throw new Error(`Qualification bundle has ${String(manifest.residualScripts.length)} residual scripts`);
  }
  const provenance = ProbeProvenance.parse(
    JSON.parse(readFileSync(join(matchProbeRoot, 'provenance.json'), 'utf8')),
  );
  const qualificationFiles = manifest.qualifications.map((entry) => ({
    path: entry.path,
    bytes: readWithin(qualificationRoot, entry.path),
    readEvidence: (path: string) => readWithin(qualificationRoot, path),
  }));
  const probeDirectory = join(matchProbeRoot, 'probes');
  const matchReceipts = readFileNames(probeDirectory)
    .map((name) => ({
      name,
      receipt: PrintedPlayProbeReceiptSchema.parse(
        JSON.parse(readFileSync(join(probeDirectory, name), 'utf8')),
      ),
    }))
    .filter(({ receipt }) => receipt.result.scope === 'match');
  if (matchReceipts.length === 0) throw new Error('Match probe bundle has no match receipts');
  for (const { receipt } of matchReceipts) {
    if (!isDeepStrictEqual(receipt.subject, provenance.subject)) {
      throw new Error(`Match probe subject mismatch: ${receipt.result.id}`);
    }
  }

  const stagingRoot = `${outputRoot}.building-${randomUUID()}`;
  try {
    cpSync(qualificationRoot, stagingRoot, { recursive: true, errorOnExist: true, force: false });
    mkdirSync(join(stagingRoot, 'match-probes'));
    const matchProbes = matchReceipts.map(({ receipt }) => {
      const path = `match-probes/${receipt.result.id}.json`;
      const bytes = json(receipt);
      writeFileSync(join(stagingRoot, path), bytes, { flag: 'wx' });
      return {
        ...receipt.result,
        evidence: { kind: 'play-probe' as const, path, sha256: digest(bytes) },
      };
    });
    const admission = buildPrintedPlayAdmissionFromScriptQualifications({
      subject: provenance.subject,
      catalogs,
      qualifications: qualificationFiles,
      matchProbes,
      ...(options.generatedObjectPolicy === undefined
        ? {}
        : { generatedObjectPolicy: options.generatedObjectPolicy }),
    });
    const body = json(admission);
    const readEvidence = (path: string): Buffer => readWithin(stagingRoot, path);
    const {
      formatId: _formatId,
      formatSha256: _formatSha256,
      catalogs: _catalogHashes,
      ...runtime
    } = provenance.subject;
    const verdict = verifyPrintedFormatPlayAdmission(body, format, catalogs, runtime, readEvidence);
    if (!verdict.admitted) throw new Error(`Built admission was refused: ${JSON.stringify(verdict.reasons)}`);
    writeFileSync(join(stagingRoot, 'admission.json'), body, { flag: 'wx' });
    renameSync(stagingRoot, outputRoot);
    return {
      outputRoot,
      cards: admission.cards.length,
      scripts: qualificationFiles.length,
      matchProbes: matchProbes.length,
    };
  } catch (cause) {
    rmSync(stagingRoot, { recursive: true, force: true });
    throw cause;
  }
}

function readFileNames(directory: string): string[] {
  return z
    .array(z.string().regex(/^[a-z0-9][a-z0-9_-]*\.json$/u))
    .parse(readdirSync(directory).filter((name) => name.endsWith('.json')))
    .sort();
}

export function scriptQualifiedAdmissionMain(argv: readonly string[]): number {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    allowPositionals: false,
    options: {
      format: { type: 'string' },
      catalog: { type: 'string', multiple: true },
      qualifications: { type: 'string' },
      'match-probes': { type: 'string' },
      out: { type: 'string' },
      'generated-object-policy': { type: 'string' },
    },
  });
  if (
    !values.format ||
    !values.catalog?.length ||
    !values.qualifications ||
    !values['match-probes'] ||
    !values.out
  ) {
    throw new Error(
      'Usage: build-script-qualified-admission --format <json> --catalog <json>... --qualifications <dir> --match-probes <dir> [--generated-object-policy forge-momir-global-creatures] --out <new-dir>',
    );
  }
  const result = buildScriptQualifiedAdmission({
    formatPath: values.format,
    catalogPaths: values.catalog,
    qualificationRoot: values.qualifications,
    matchProbeRoot: values['match-probes'],
    outputRoot: values.out,
    ...(values['generated-object-policy'] === undefined
      ? {}
      : {
          generatedObjectPolicy: z
            .literal('forge-momir-global-creatures')
            .parse(values['generated-object-policy']),
        }),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = scriptQualifiedAdmissionMain(process.argv.slice(2));
  } catch (cause) {
    process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exitCode = 1;
  }
}
