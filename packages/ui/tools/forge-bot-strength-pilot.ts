/** Execute the first pinned cross-format Forge bot-strength tuning campaign. */
import { createHash } from 'node:crypto';
import { constants, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import type { DeckRef, ObservedBackend } from '@mtg/engine';
import {
  compileInstalledForgeBridge,
  createForgeRuntimeSnapshot,
  type ForgeRuntimeSnapshot,
  type ForgeRuntimeIdentity,
} from '@mtg/forge-export';
import type { ForgeBotStrengthBackend } from '@mtg/metrics';
import { parsePrintedCardCatalog, parsePrintedFormat, parsePrintedLimitedFormat } from '@mtg/printed-card';
import { admitPrintedBackend } from './admitted-printed-backend';
import {
  finalizeBotStrengthCampaignArtifacts,
  openBotStrengthCampaignArtifacts,
} from './bot-strength-artifacts';
import {
  bundleForgeCampaignRuntime,
  importForgeCampaignRuntimeArtifact,
} from './forge-campaign-runtime-bundle';
import { loadForgeDeckFile } from './forge-deck-file';
import { discoverForgeHome } from './forge-home';
import { buildGeneralForgePilotPlan, type GeneralForgePilotInputs } from './general-forge-pilot-plan';
import { bundleInstalledForgeAdapter } from './installed-adapter-bundle';
import { openPinnedInstalledForgeBackend } from './pinned-forge-backend';
import { loadPrintedAdmissionSource, parsePrintedFormatRegistry } from './printed-format-registry';

const CUBE_FORMAT = 'legacy-cube-2021-08';
const PRINTED_FORMAT = 'akh-hou';
const MAXIMUM_TURNS = 200;
const MAXIMUM_DECISIONS = 5_000;

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseOutput(args: readonly string[]): string {
  if (args.length !== 2 || args[0] !== '--out' || (args[1] ?? '').trim() === '') {
    throw new Error('usage: tsx packages/ui/tools/forge-bot-strength-pilot.ts --out <new-directory>');
  }
  return resolve(args[1]!);
}

function sameRuntime(left: ForgeRuntimeIdentity, right: ForgeRuntimeIdentity): void {
  if (!isDeepStrictEqual(left, right)) {
    throw new Error('Legacy Cube and AKH/HOU backends do not share one measured Forge runtime.');
  }
}

async function shutdown(backends: readonly ObservedBackend[]): Promise<void> {
  const results = await Promise.allSettled(backends.map((backend) => backend.shutdown?.()));
  const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
  if (failures.length > 0) throw new AggregateError(failures, 'Forge campaign backend shutdown failed.');
}

function repoPath(repoRoot: string, path: string): string {
  return relative(repoRoot, path).replaceAll('\\', '/');
}

export interface GeneralForgeCampaignDecks {
  readonly cubeFocal: ReturnType<typeof loadForgeDeckFile>;
  readonly cubeOpponentA: ReturnType<typeof loadForgeDeckFile>;
  readonly cubeOpponentB: ReturnType<typeof loadForgeDeckFile>;
  readonly draftFocal: ReturnType<typeof loadForgeDeckFile>;
  readonly draftOpponent: ReturnType<typeof loadForgeDeckFile>;
  readonly sealedFocal: ReturnType<typeof loadForgeDeckFile>;
  readonly sealedOpponent: ReturnType<typeof loadForgeDeckFile>;
}

export interface GeneralForgeCampaignConfiguration {
  readonly campaign?: GeneralForgePilotInputs['campaign'];
  readonly baseline: 'coverage-v8' | 'legal-v1';
  readonly inputAttestation?: unknown;
}

export async function runGeneralForgeCampaign(
  repoRoot: string,
  outputDirectory: string,
  loadedDecks: GeneralForgeCampaignDecks,
  configuration: GeneralForgeCampaignConfiguration,
): Promise<void> {
  const output = resolve(outputDirectory);
  const forgeHome = discoverForgeHome(repoRoot);
  if (forgeHome === undefined) throw new Error('Pinned Forge distribution was not found.');

  const registry = parsePrintedFormatRegistry(
    repoRoot,
    JSON.parse(readFileSync(join(repoRoot, 'packages/data/data/printed-formats-v1.json'), 'utf8')),
  );
  const source = registry.find((entry) => {
    const body = JSON.parse(readFileSync(join(entry.directory, entry.formatFile), 'utf8')) as unknown;
    return parsePrintedFormat(body).id === PRINTED_FORMAT;
  });
  if (source === undefined) throw new Error(`Printed registry has no ${PRINTED_FORMAT} format.`);
  const admissionSource = loadPrintedAdmissionSource(source);
  if (admissionSource === undefined) throw new Error(`${PRINTED_FORMAT} has no installed play admission.`);

  const scratchParent = join(repoRoot, 'out/tmp');
  mkdirSync(scratchParent, { recursive: true });
  const scratch = mkdtempSync(join(scratchParent, 'forge-bot-strength-pilot-'));
  const snapshots = join(scratch, 'snapshots');
  mkdirSync(snapshots);

  let compiled: ReturnType<typeof compileInstalledForgeBridge> = null;
  let recorder: ReturnType<typeof openBotStrengthCampaignArtifacts> | null = null;
  let backends: readonly ObservedBackend[] = [];
  let orphanedCubeSnapshot: ForgeRuntimeSnapshot | null = null;
  try {
    compiled = compileInstalledForgeBridge({ forgeHome, outputParent: scratch });
    if (compiled === null) throw new Error('Pinned Forge bridge could not be compiled.');
    const adapterBundlePath = await bundleInstalledForgeAdapter(repoRoot, join(scratch, 'adapter'));
    const policyArtifact = await bundleForgeCampaignRuntime(repoRoot, join(scratch, 'policy'));
    const policyRuntime = await importForgeCampaignRuntimeArtifact(policyArtifact.path);
    if (policyRuntime.sha256 !== policyArtifact.sha256) {
      throw new Error('Forge campaign runtime changed between build and import.');
    }
    const runtimeInput = {
      forgeHome,
      bridge: { kind: 'compiled' as const, path: compiled.classDirectory },
      adapterBundlePath,
    };
    const cubeSnapshot = createForgeRuntimeSnapshot({ ...runtimeInput, outputParent: snapshots });
    orphanedCubeSnapshot = cubeSnapshot;
    const cubeBackend = await openPinnedInstalledForgeBackend(cubeSnapshot, CUBE_FORMAT);
    orphanedCubeSnapshot = null;
    backends = [cubeBackend];
    const printed = await admitPrintedBackend({
      ...admissionSource,
      runtime: runtimeInput,
      outputParent: snapshots,
    });
    if (!printed.admitted) {
      throw new Error(`AKH/HOU runtime admission refused: ${JSON.stringify(printed.reasons)}`);
    }
    backends = [...backends, printed.backend];
    const printedRuntime: ForgeRuntimeIdentity = {
      forgeVersion: printed.subject.forgeVersion,
      forgeJarSha256: printed.subject.forgeJarSha256,
      scriptArchiveSha256: printed.subject.scriptArchiveSha256,
      resourcesSha256: printed.subject.resourcesSha256,
      bridgeSha256: printed.subject.bridgeSha256,
      adapterSha256: printed.subject.adapterSha256,
      protocolVersion: printed.subject.protocolVersion,
    };
    sameRuntime(cubeSnapshot.identity, printedRuntime);

    const campaignBuildSha256 = botEvidenceSha256({
      version: 'forge-campaign-runtime/v1',
      forgeRuntime: cubeSnapshot.identity,
      policyBundleSha256: policyRuntime.sha256,
    });
    const opponentPolicy = {
      policyId: `forge-default@${cubeSnapshot.identity.forgeVersion}`,
      configSha256: botEvidenceSha256({
        controller: 'engine',
        aiMode: 'Default',
        forgeRuntime: cubeSnapshot.identity,
      }),
      modelSha256: null,
      dataSha256: null,
    };
    const cubeProvenancePath = join(repoRoot, 'packages/data/data/legacy-cube-2021-v1.json');
    const cubeCatalogPath = join(repoRoot, 'packages/data/data/legacy-cube-2021-card-catalog-v1.json');
    const cubeCatalog = parsePrintedCardCatalog(JSON.parse(readFileSync(cubeCatalogPath, 'utf8')));
    const printedFormat = parsePrintedLimitedFormat(admissionSource.format);
    const baseline =
      configuration.baseline === 'legal-v1'
        ? policyRuntime.module.forgeObservedLegalBaselinePolicy
        : policyRuntime.module.forgeObservedCoveragePolicyV8;
    const plan = buildGeneralForgePilotPlan({
      ...(configuration.campaign === undefined ? {} : { campaign: configuration.campaign }),
      runtime: {
        version: `forge-${cubeSnapshot.identity.forgeVersion}/campaign-v1`,
        buildSha256: campaignBuildSha256,
      },
      policies: {
        baseline,
        candidate: policyRuntime.module.strongestForgeObservedPolicy,
      },
      formats: {
        cube: {
          id: CUBE_FORMAT,
          formatSha256: sha256(readFileSync(cubeProvenancePath)),
          cardsSha256: cubeCatalog.contentSha256,
        },
        printed: {
          id: PRINTED_FORMAT,
          formatSha256: printedFormat.contentSha256,
          cardsSha256: botEvidenceSha256({
            catalogs: printedFormat.sources.map(({ code, catalogSha256 }) => ({ code, catalogSha256 })),
          }),
        },
      },
      decks: {
        cubeFocal: loadedDecks.cubeFocal.sha256,
        cubeOpponents: [loadedDecks.cubeOpponentA.sha256, loadedDecks.cubeOpponentB.sha256],
        draftFocal: loadedDecks.draftFocal.sha256,
        draftOpponent: loadedDecks.draftOpponent.sha256,
        sealedFocal: loadedDecks.sealedFocal.sha256,
        sealedOpponent: loadedDecks.sealedOpponent.sha256,
      },
      opponentPolicy,
    });
    const runtimeManifest = {
      version: 'forge-bot-strength-runtime/v1',
      campaignBuildSha256,
      forgeRuntime: cubeSnapshot.identity,
      policyBundle: { file: 'campaign-runtime.mjs', sha256: policyRuntime.sha256 },
      installedAdapter: { file: 'installed-adapter.mjs', sha256: cubeSnapshot.identity.adapterSha256 },
      printedAdmissionSubject: printed.subject,
      decks: Object.fromEntries(
        Object.entries(loadedDecks).map(([id, deck]) => [
          id,
          { path: repoPath(repoRoot, deck.path), sha256: deck.sha256 },
        ]),
      ),
      limits: { maximumTurns: MAXIMUM_TURNS, maximumDecisions: MAXIMUM_DECISIONS },
      ...(configuration.inputAttestation === undefined
        ? {}
        : { inputAttestation: configuration.inputAttestation }),
    };
    mkdirSync(dirname(output), { recursive: true });
    recorder = openBotStrengthCampaignArtifacts(output, plan, runtimeManifest);
    copyFileSync(policyArtifact.path, join(output, 'campaign-runtime.mjs'), constants.COPYFILE_EXCL);
    copyFileSync(adapterBundlePath, join(output, 'installed-adapter.mjs'), constants.COPYFILE_EXCL);

    const decks = new Map<string, DeckRef>(
      Object.values(loadedDecks).map((loaded) => [loaded.sha256, loaded.deck]),
    );
    if (decks.size !== Object.keys(loadedDecks).length)
      throw new Error('Campaign deck hashes are not unique.');
    const attested = { backend: cubeBackend, opponentPolicy };
    const forgeBackends = new Map<string, ForgeBotStrengthBackend>([
      [CUBE_FORMAT, attested],
      [PRINTED_FORMAT, { backend: printed.backend, opponentPolicy }],
    ]);
    await policyRuntime.module.executeForgeBotStrengthCampaign({
      plan,
      policies: {
        baseline,
        candidate: policyRuntime.module.strongestForgeObservedPolicy,
      },
      decks,
      backends: forgeBackends,
      maximumTurns: MAXIMUM_TURNS,
      maximumDecisions: MAXIMUM_DECISIONS,
      onTrial: recorder.checkpoint,
    });
    recorder.abort();
    recorder = null;
    await finalizeBotStrengthCampaignArtifacts(output);
  } finally {
    recorder?.abort();
    try {
      await shutdown(backends);
    } finally {
      orphanedCubeSnapshot?.dispose();
      compiled?.dispose();
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}

export async function runGeneralForgePilot(repoRoot: string, outputDirectory: string): Promise<void> {
  const deckPaths = {
    cubeFocal: join(
      repoRoot,
      'out/legacy-cube-bot-final-20260910/decks/4572c0cdf6777360998592002525763afa76e7709e0fd2e9edc6fb7d26185f64.dck',
    ),
    cubeOpponentA: join(
      repoRoot,
      'out/legacy-cube-bot-final-20260910/decks/5991133f7ede4e79d5545920acaaa91cdf75ffdaa939d1ba4a12207d300ecb99.dck',
    ),
    cubeOpponentB: join(
      repoRoot,
      'out/legacy-cube-bot-final-20260910/decks/039acfb40c1086df1310bf389a3a2dfa8d82d64404250ef94294f30c2c1168a5.dck',
    ),
    draftFocal: join(
      repoRoot,
      'out/validation-pilot/akh-hou-native-smoke-v1/draft/printed-sample-seat-0.dck',
    ),
    draftOpponent: join(
      repoRoot,
      'out/validation-pilot/akh-hou-native-smoke-v1/draft/printed-sample-seat-1.dck',
    ),
    sealedFocal: join(
      repoRoot,
      'out/validation-pilot/akh-hou-native-smoke-v1/sealed/printed-sample-seat-0.dck',
    ),
    sealedOpponent: join(
      repoRoot,
      'out/validation-pilot/akh-hou-native-smoke-v1/sealed/printed-sample-seat-1.dck',
    ),
  };
  const loadedDecks = Object.fromEntries(
    Object.entries(deckPaths).map(([id, path]) => [id, loadForgeDeckFile(path)]),
  ) as unknown as GeneralForgeCampaignDecks;
  await runGeneralForgeCampaign(repoRoot, outputDirectory, loadedDecks, { baseline: 'coverage-v8' });
}

const invoked =
  process.argv[1] === undefined ? false : resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  await runGeneralForgePilot(repoRoot, parseOutput(process.argv.slice(2)));
}
