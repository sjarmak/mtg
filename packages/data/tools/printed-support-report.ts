/** Read-only historical evidence inspection. Never measures, starts, or admits a live backend. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { z } from 'zod';
import { parsePrintedLimitedFormat, PrintedPlaySubjectSchema } from '@mtg/printed-card';
import { buildPrintedFormatSupportReport } from '../src/printed-card/support-report';

const Path = z.string().trim().min(1);
const Config = z.strictObject({
  schemaVersion: z.literal(1),
  runtimeScope: z.literal('historical'),
  runtimeProvenance: Path,
  format: Path,
  catalogs: z.array(Path).min(1),
  admission: Path,
  evidenceRoot: Path,
  forgeScripts: Path,
});
const usage =
  'Usage: npx tsx packages/data/tools/printed-support-report.ts --config <json>\nWrites a historical support report to stdout; does not enable play or verify a live runtime.';
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function readRegularFile(path: string): Buffer {
  if (!statSync(path).isFile()) throw new Error(`Expected a regular file: ${path}`);
  return readFileSync(path);
}
const readJson = (path: string): unknown => JSON.parse(readRegularFile(path).toString('utf8'));

/** Logical artifact paths are validated by the existing admission verifier before this callback. */
function evidenceReader(path: string) {
  const root = realpathSync(path);
  if (!statSync(root).isDirectory()) throw new Error('Evidence root must be a directory');
  return (artifact: string): Buffer => {
    const candidate = realpathSync(resolve(root, artifact));
    const inside = relative(root, candidate);
    if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside))
      throw new Error(`File outside evidence root: ${artifact}`);
    return readRegularFile(candidate);
  };
}

function historicalReport(configPath: string) {
  const configBytes = readRegularFile(configPath);
  const config = Config.parse(JSON.parse(configBytes.toString('utf8')));
  const path = (value: string): string => resolve(dirname(configPath), value);
  const provenancePath = path(config.runtimeProvenance);
  const provenanceBytes = readRegularFile(provenancePath);
  // The probe producer includes other audit fields. Only its measured subject is used here.
  const { subject } = z
    .object({ subject: PrintedPlaySubjectSchema })
    .parse(JSON.parse(provenanceBytes.toString('utf8')));
  const format = parsePrintedLimitedFormat(readJson(path(config.format)));
  const { formatId, formatSha256, catalogs: sourceHashes, ...runtime } = subject;
  if (
    formatId !== format.id ||
    formatSha256 !== format.contentSha256 ||
    !isDeepStrictEqual(
      sourceHashes,
      Object.fromEntries(format.sources.map((source) => [source.code, source.catalogSha256])),
    )
  )
    throw new Error('Historical provenance does not match the requested format');
  const archive = path(config.forgeScripts);
  const archiveSha256 = digest(readRegularFile(archive));
  if (archiveSha256 !== runtime.scriptArchiveSha256)
    throw new Error('Historical script archive checksum mismatch');
  const report = buildPrintedFormatSupportReport({
    admission: readRegularFile(path(config.admission)).toString('utf8'),
    format,
    catalogs: config.catalogs.map((file) => readJson(path(file))),
    measuredRuntime: runtime,
    readEvidence: evidenceReader(path(config.evidenceRoot)),
    readScript: (member) =>
      execFileSync('unzip', ['-p', archive, member], {
        maxBuffer: 1024 * 1024,
        timeout: 10_000,
      }),
  });
  if (digest(readRegularFile(archive)) !== archiveSha256)
    throw new Error('Historical script archive changed during verification');
  return {
    ...report,
    runtimeScope: 'historical' as const,
    liveRuntimeVerified: false,
    provenance: {
      config: { path: configPath, sha256: digest(configBytes) },
      runtime: { path: provenancePath, sha256: digest(provenanceBytes) },
      scriptArchive: { path: archive, sha256: archiveSha256 },
    },
  };
}

export function printedSupportReportMain(
  argv: readonly string[],
  io: { readonly stdout: (text: string) => void; readonly stderr: (text: string) => void } = {
    stdout: (text) => process.stdout.write(`${text}\n`),
    stderr: (text) => process.stderr.write(`${text}\n`),
  },
): number {
  if (argv.length === 1 && argv[0] === '--help') {
    io.stdout(usage);
    return 0;
  }
  try {
    const { values, tokens } = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: false,
      tokens: true,
      options: { config: { type: 'string' } },
    });
    if (tokens.filter((token) => token.kind === 'option').length !== 1)
      throw new Error('Exactly one --config option is required');
    const args = z.strictObject({ config: Path }).parse(values);
    io.stdout(JSON.stringify(historicalReport(resolve(args.config)), null, 2));
    return 0;
  } catch (cause) {
    io.stderr(`Printed support report failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = printedSupportReportMain(process.argv.slice(2));
