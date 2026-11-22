/** Execute the preregistered ISD Forge-ranked versus structural construction holdout. */
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  copyFileSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import { preparePrintedLimitedFormat } from '@mtg/draft-export';
import type { DeckRef, ObservedBackend } from '@mtg/engine';
import { compileInstalledForgeBridge } from '@mtg/forge-export';
import { prepareLimitedDeck, toDeckRef } from '@mtg/limited';
import { parsePrintedCardCatalog, parsePrintedLimitedFormat } from '@mtg/printed-card';
import { suggestPrintedDeck } from '../src/routes/printed/deck-evaluation';
import { printedLimitedFacts } from '../src/routes/printed/limited-facts';
import { admitPrintedBackend } from './admitted-printed-backend';
import { bundleInstalledForgeAdapter } from './installed-adapter-bundle';
import { buildIsdLimitedConstructionPlan } from './isd-limited-construction-plan';
import {
  bundlePrintedLimitedConstructionRuntime,
  importPrintedLimitedConstructionRuntime,
} from './printed-limited-construction-runtime-bundle';
import {
  bindPrintedConstructionBackend,
  forgeGameplayFeatureIdentity,
  forgeGameplayPolicyIdentity,
  printedConstructionForgeRuntime,
  printedLimitedConstructionPolicies,
  printedLimitedSubjectIdentity,
} from './printed-limited-construction-campaign';
import { buildInstalledPrintedDraftRatings } from './printed-draft-ratings';
import { discoverForgeHome } from './forge-home';
import { loadPrintedAdmissionSource, parsePrintedFormatRegistry } from './printed-format-registry';
import {
  finalizeStageStrengthCampaignArtifacts,
  openStageStrengthCampaignArtifacts,
} from './stage-strength-artifacts';

const FORMAT_ID = 'isd';
const MAXIMUM_TURNS = 200;
const MAXIMUM_DECISIONS = 5_000;

function parseOutput(args: readonly string[]): string {
  if (args.length !== 2 || args[0] !== '--out' || (args[1] ?? '').trim() === '') {
    throw new Error(
      'usage: tsx packages/ui/tools/isd-limited-construction-campaign.ts --out <new-directory>',
    );
  }
  return resolve(args[1]!);
}

function sha256(text: string): Promise<string> {
  return Promise.resolve(createHash('sha256').update(text).digest('hex'));
}

function rankedOpponent(
  prepared: Awaited<ReturnType<typeof preparePrintedLimitedFormat>>,
  ratings: Awaited<ReturnType<typeof buildInstalledPrintedDraftRatings>>['artifacts'] extends ReadonlyMap<
    string,
    infer Rating
  >
    ? Rating
    : never,
  id: string,
): DeckRef {
  const initial = prepareLimitedDeck(prepared.openSealedPool(`${id}/sealed`).cards, (card) =>
    printedLimitedFacts(card.payload.printing),
  );
  return toDeckRef(suggestPrintedDeck(initial, ratings), id);
}

function fsyncCopy(source: string, target: string): void {
  copyFileSync(source, target, constants.COPYFILE_EXCL);
  const file = openSync(target, 'r');
  try {
    fsyncSync(file);
  } finally {
    closeSync(file);
  }
  const directory = openSync(dirname(target), 'r');
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

async function shutdown(backend: ObservedBackend | null): Promise<void> {
  await backend?.shutdown?.();
}

export async function runIsdLimitedConstructionCampaign(
  repoRoot: string,
  outputDirectory: string,
): Promise<void> {
  const forgeHome = discoverForgeHome(repoRoot);
  if (forgeHome === undefined) throw new Error('Pinned Forge distribution was not found.');
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
  const admissionSource = loadPrintedAdmissionSource(source);
  if (admissionSource === undefined) throw new Error('ISD has no installed play admission.');

  const ratingsResult = await buildInstalledPrintedDraftRatings([source]);
  const ratings = ratingsResult.artifacts.get(FORMAT_ID);
  if (ratings === undefined) throw new Error(ratingsResult.messages.join('; '));
  const catalogs = source.catalogs.map(({ code, file }) => ({
    code,
    catalog: parsePrintedCardCatalog(JSON.parse(readFileSync(join(source.directory, file), 'utf8'))),
  }));
  const prepared = await preparePrintedLimitedFormat(
    admissionSource.format,
    catalogs.map(({ catalog }) => catalog),
    sha256,
  );

  const scratchParent = join(repoRoot, 'out/tmp');
  mkdirSync(scratchParent, { recursive: true });
  const scratch = mkdtempSync(join(scratchParent, 'isd-limited-construction-'));
  let compiled: ReturnType<typeof compileInstalledForgeBridge> = null;
  let backend: ObservedBackend | null = null;
  let recorder: ReturnType<typeof openStageStrengthCampaignArtifacts> | null = null;
  try {
    compiled = compileInstalledForgeBridge({ forgeHome, outputParent: scratch });
    if (compiled === null) throw new Error('Pinned Forge bridge could not be compiled.');
    const adapterBundlePath = await bundleInstalledForgeAdapter(repoRoot, join(scratch, 'adapter'));
    const runtimeArtifact = await bundlePrintedLimitedConstructionRuntime(repoRoot, join(scratch, 'runtime'));
    const runtime = await importPrintedLimitedConstructionRuntime(runtimeArtifact.path);
    if (runtime.sha256 !== runtimeArtifact.sha256) {
      throw new Error('Construction runtime changed between build and import.');
    }
    const snapshots = join(scratch, 'snapshots');
    mkdirSync(snapshots);
    const admitted = await admitPrintedBackend({
      ...admissionSource,
      runtime: {
        forgeHome,
        bridge: { kind: 'compiled', path: compiled.classDirectory },
        adapterBundlePath,
      },
      outputParent: snapshots,
    });
    if (!admitted.admitted)
      throw new Error(`ISD runtime admission refused: ${JSON.stringify(admitted.reasons)}`);
    backend = admitted.backend;

    const opponents = new Map<string, DeckRef>([
      ['frozen-opponent-a', rankedOpponent(prepared, ratings, 'frozen-opponent-a')],
      ['frozen-opponent-b', rankedOpponent(prepared, ratings, 'frozen-opponent-b')],
    ]);
    if (new Set([...opponents.values()].map(botEvidenceSha256)).size !== opponents.size) {
      throw new Error('Frozen ISD opponents must be distinct.');
    }
    const opponentPolicy = {
      policyId: `forge-default@${admitted.subject.forgeVersion}`,
      configSha256: botEvidenceSha256({
        controller: 'engine',
        aiMode: 'Default',
        forgeRuntime: admitted.subject,
      }),
      modelSha256: null,
      dataSha256: null,
    };
    const gameplayPolicy = runtime.module.strongestForgeObservedPolicy;
    const builderRuntime = {
      kind: 'analysis' as const,
      version: 'printed-limited-construction-runtime/v1',
      buildSha256: runtime.sha256,
    };
    const plan = buildIsdLimitedConstructionPlan({
      subject: printedLimitedSubjectIdentity(prepared),
      builderRuntime,
      builderPolicies: printedLimitedConstructionPolicies(ratings),
      gameplayRuntime: printedConstructionForgeRuntime(admitted.subject),
      gameplayFeatures: forgeGameplayFeatureIdentity(gameplayPolicy),
      gameplayPolicy: forgeGameplayPolicyIdentity(gameplayPolicy),
      opponentPolicy,
      opponents,
    });
    const runtimeManifest = {
      version: 'isd-limited-construction-runtime/v1',
      executableBundleSha256: runtime.sha256,
      installedAdapterSha256: admitted.subject.adapterSha256,
      admissionSubject: admitted.subject,
      ratings,
      opponents: Object.fromEntries(opponents),
      limits: { maximumTurns: MAXIMUM_TURNS, maximumDecisions: MAXIMUM_DECISIONS },
    };
    mkdirSync(dirname(resolve(outputDirectory)), { recursive: true });
    recorder = openStageStrengthCampaignArtifacts(outputDirectory, plan, runtimeManifest);
    fsyncCopy(runtimeArtifact.path, join(resolve(outputDirectory), 'construction-runtime.mjs'));
    fsyncCopy(adapterBundlePath, join(resolve(outputDirectory), 'installed-adapter.mjs'));
    await runtime.module.executePrintedLimitedConstructionCampaign({
      plan,
      builderRuntime,
      gameplayPolicy,
      subjects: new Map([
        [
          FORMAT_ID,
          {
            prepared,
            catalogs,
            ratings,
            backend: bindPrintedConstructionBackend(admitted, opponentPolicy),
          },
        ],
      ]),
      opponents,
      maximumTurns: MAXIMUM_TURNS,
      maximumDecisions: MAXIMUM_DECISIONS,
      onTrial: recorder.checkpoint,
    });
    recorder.abort();
    recorder = null;
    await finalizeStageStrengthCampaignArtifacts(outputDirectory);
  } finally {
    recorder?.abort();
    try {
      await shutdown(backend);
    } finally {
      compiled?.dispose();
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}

const invoked =
  process.argv[1] === undefined ? false : resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  await runIsdLimitedConstructionCampaign(repoRoot, parseOutput(process.argv.slice(2)));
}
