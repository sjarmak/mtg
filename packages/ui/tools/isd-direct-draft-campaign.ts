/** Run the compact ISD direct-pick holdout without starting Forge gameplay. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preparePrintedLimitedFormat } from '@mtg/draft-export';
import { parsePrintedCardCatalog, parsePrintedLimitedFormat } from '@mtg/printed-card';
import { printedLimitedSubjectIdentity } from './printed-limited-construction-campaign';
import { buildIsdDirectDraftPlan } from './isd-direct-draft-plan';
import {
  bundlePrintedLimitedDraftRuntime,
  importPrintedLimitedDraftRuntime,
} from './printed-limited-draft-runtime-bundle';
import { printedLimitedDraftPolicies } from './printed-limited-draft-campaign';
import { writePrintedDirectDraftArtifacts } from './printed-limited-direct-draft-campaign';
import { buildInstalledPrintedDraftRatings } from './printed-draft-ratings';
import { parsePrintedFormatRegistry } from './printed-format-registry';

const FORMAT_ID = 'isd';

function parseOutput(args: readonly string[]): string {
  if (args.length !== 2 || args[0] !== '--out' || (args[1] ?? '').trim() === '') {
    throw new Error('usage: tsx packages/ui/tools/isd-direct-draft-campaign.ts --out <new-directory>');
  }
  return resolve(args[1]!);
}

export async function runIsdDirectDraftCampaign(repoRoot: string, outputDirectory: string) {
  const resolvedOutput = resolve(outputDirectory);
  if (existsSync(resolvedOutput)) {
    throw new Error(`Direct draft output already exists: ${resolvedOutput}`);
  }
  const registry = parsePrintedFormatRegistry(
    repoRoot,
    JSON.parse(readFileSync(join(repoRoot, 'packages/data/data/printed-formats-v1.json'), 'utf8')),
  );
  const source = registry.find(
    (candidate) =>
      parsePrintedLimitedFormat(
        JSON.parse(readFileSync(join(candidate.directory, candidate.formatFile), 'utf8')),
      ).id === FORMAT_ID,
  );
  if (source === undefined) throw new Error('Printed registry has no ISD format.');
  const builtRatings = await buildInstalledPrintedDraftRatings([source]);
  const ratings = builtRatings.artifacts.get(FORMAT_ID);
  if (ratings === undefined) throw new Error(builtRatings.messages.join('; '));
  const catalogs = source.catalogs.map(({ code, file }) => ({
    code,
    catalog: parsePrintedCardCatalog(JSON.parse(readFileSync(join(source.directory, file), 'utf8'))),
  }));
  const prepared = await preparePrintedLimitedFormat(
    JSON.parse(readFileSync(join(source.directory, source.formatFile), 'utf8')),
    catalogs.map(({ catalog }) => catalog),
    async (text) => createHash('sha256').update(text).digest('hex'),
  );
  const runtimeDirectory = join(resolvedOutput, 'runtime');
  mkdirSync(runtimeDirectory, { recursive: true });
  const bundled = await bundlePrintedLimitedDraftRuntime(repoRoot, runtimeDirectory);
  const runtimeModule = await importPrintedLimitedDraftRuntime(bundled.path);
  if (runtimeModule.sha256 !== bundled.sha256)
    throw new Error('Direct draft runtime changed after bundling.');
  const runtime = {
    kind: 'native' as const,
    version: 'printed-limited-direct-draft-runtime/v1',
    buildSha256: bundled.sha256,
  };
  const plan = buildIsdDirectDraftPlan({
    runtime,
    subject: printedLimitedSubjectIdentity(prepared),
    policies: printedLimitedDraftPolicies(ratings),
  });
  const result = await runtimeModule.module.runPrintedLimitedDirectDraftCampaign({
    plan,
    runtime,
    subjects: new Map([[FORMAT_ID, { prepared, catalogs, ratings }]]),
  });
  const resultPath = writePrintedDirectDraftArtifacts(resolvedOutput, result);
  return { resultPath, runtimePath: bundled.path, result };
}

const invoked =
  process.argv[1] === undefined ? false : resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const completed = await runIsdDirectDraftCampaign(repoRoot, parseOutput(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(completed.result.summary, null, 2)}\n`);
}
