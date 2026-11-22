/** Offline IO boundary; writes completion evidence last and never replaces a prior run. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { format as prettierFormat, resolveConfig } from 'prettier';
import { buildPrintedFormat, PrintedFormatRecipeSchema } from './format-build';
import { parsePrintedSourcePin } from './source-pin';

export interface PrintedFormatBuildPaths {
  readonly config: string;
  readonly sourceRoot: string;
  readonly archive: string;
  readonly forgeVersion: string;
  readonly output: string;
}
/** `<id>-limited-format-v1.json` or `<id>-constructed-format-v1.json`; the registry names the same file. */
export function printedFormatFileName(id: string, kind: 'limited' | 'constructed'): string {
  return `${id}-${kind}-format-v1.json`;
}
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
/**
 * The bytes a JSON artifact is committed as. `npm run format` checks every tracked
 * `packages/**\/*.json`, and the evidence hashes the file as written, so an artifact
 * must leave the writer already prettier-formatted: formatting it afterwards moves a
 * hash the evidence recorded. `filepath` selects the JSON parser; the repo's prettier config
 * is found from the working directory, so the tools run from the repo root.
 */
export async function formatJsonArtifact(value: unknown, filepath: string): Promise<string> {
  const config = await resolveConfig(resolve(filepath));
  return prettierFormat(JSON.stringify(value), { ...config, filepath });
}

/**
 * `Lightning Bolt` -> `lightning_bolt.txt`, the way Forge's `cardsfolder` names a script.
 * Forge folds a diacritic to its base letter (`Séance` -> `seance.txt`, `Jötun Grunt` ->
 * `jotun_grunt.txt`, `Lim-Dûl` -> `lim_dul`) and spells the ligature out (`Æther Vial` ->
 * `aether_vial.txt`); stripping every non-ASCII letter instead looked `Séance` up as `sance.txt`.
 */
export function forgeScriptFileName(cardName: string): string {
  const slug = cardName
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '_');
  return `${slug}.txt`;
}

function scriptReader(archive: string) {
  const paths = execFileSync('unzip', ['-Z1', archive], {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
  })
    .trim()
    .split('\n');
  // A run-local IO cache only: catalog assembly still checks every exact printing and Name line.
  const cache = new Map<string, Uint8Array>();
  return {
    reads: () => cache.size,
    scriptFor: (card: { readonly name: string }) => {
      const filename = forgeScriptFileName(card.name);
      const matches = paths.filter((path) => path.endsWith(`/${filename}`));
      if (matches.length !== 1) return null;
      const path = matches[0]!;
      const bytes =
        cache.get(path) ??
        execFileSync('unzip', ['-p', archive, path], {
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        });
      cache.set(path, bytes);
      return { path, bytes };
    },
  };
}

async function prepareArtifacts(paths: PrintedFormatBuildPaths) {
  const recipe = PrintedFormatRecipeSchema.parse(JSON.parse(readFileSync(paths.config, 'utf8')));
  const manifest = readFileSync(join(paths.sourceRoot, 'sources.json'), 'utf8');
  const pin = parsePrintedSourcePin(manifest, (file) => readFileSync(join(paths.sourceRoot, file), 'utf8'));
  const archiveSha256 = digest(readFileSync(paths.archive));
  const scripts = scriptReader(resolve(paths.archive));
  const result = buildPrintedFormat(recipe, pin, {
    version: paths.forgeVersion,
    scriptFor: scripts.scriptFor,
  });
  if (digest(readFileSync(paths.archive)) !== archiveSha256)
    throw new Error('Forge archive changed during build');
  // The source pin stays verbatim: catalogs bind its raw checksum, and it is a recorded transport payload.
  const named: [string, unknown][] = [
    ['recipe.json', result.recipe],
    ...result.catalogs.map((catalog, index): [string, unknown] => [
      `${recipe.sourceCodes[index]!.toLowerCase()}-printed-catalog-v1.json`,
      catalog,
    ]),
    [printedFormatFileName(recipe.id, recipe.kind ?? 'limited'), result.format],
  ];
  const artifacts: Record<string, string> = { 'sources.json': manifest };
  for (const [file, value] of named) artifacts[file] = await formatJsonArtifact(value, file);
  return { result, artifacts, archiveSha256, sourceSha256: pin.sha256, scriptReads: scripts.reads() };
}

export async function writePrintedFormat(paths: PrintedFormatBuildPaths) {
  const start = performance.now();
  const output = resolve(paths.output);
  if (existsSync(output)) throw new Error(`Output already exists; choose a new run directory: ${output}`);
  const prepared = await prepareArtifacts(paths);
  const report = {
    schemaVersion: 1,
    status: prepared.result.status,
    formatId: prepared.result.format.id,
    formatSha256: prepared.result.format.contentSha256,
    sourceSha256: prepared.sourceSha256,
    archiveSha256: prepared.archiveSha256,
    forgeVersion: paths.forgeVersion,
    artifactSha256: Object.fromEntries(
      Object.entries(prepared.artifacts).map(([file, bytes]) => [file, digest(bytes)]),
    ),
    catalogs: prepared.result.format.sources.map((source, index) => ({
      code: source.code,
      cards: prepared.result.catalogs[index]!.cards.length,
      contentSha256: source.catalogSha256,
    })),
    metrics: {
      elapsedMs: performance.now() - start,
      modelCalls: 0,
      networkRequests: 0,
      scriptReads: prepared.scriptReads,
      printings: prepared.result.catalogs.reduce((sum, catalog) => sum + catalog.cards.length, 0),
    },
  };
  const evidence = await formatJsonArtifact(report, 'build-evidence.json');
  mkdirSync(dirname(output), { recursive: true }); // A fresh out/<id>/ has no parent yet.
  mkdirSync(output); // Also closes the race after the early existence check.
  for (const [file, bytes] of Object.entries(prepared.artifacts)) {
    writeFileSync(join(output, file), bytes, { flag: 'wx' });
  }
  writeFileSync(join(output, 'build-evidence.json'), evidence, { flag: 'wx' });
  return report;
}
