/** Execute the frozen Legacy Cube draft and builder tuning campaigns. */
import { createHash } from 'node:crypto';
import {
  constants,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { botEvidenceSha256 } from '@mtg/bot-evidence';
import type { DeckRef, ObservedBackend } from '@mtg/engine';
import {
  compileInstalledForgeBridge,
  createForgeRuntimeSnapshot,
  type ForgeRuntimeSnapshot,
} from '@mtg/forge-export';
import { buildCalibrationDeck, draftCalibrationPool } from '@mtg/metrics';
import { parsePrintedCardCatalog } from '@mtg/printed-card';
import { bundleInstalledForgeAdapter } from './installed-adapter-bundle';
import { discoverForgeHome } from './forge-home';
import { forgeGameplayFeatureIdentity, forgeGameplayPolicyIdentity } from './forge-stage-deck-outcome';
import {
  bundleLegacyCubeStageRuntime,
  importLegacyCubeStageRuntime,
} from './legacy-cube-stage-runtime-bundle';
import { buildLegacyCubeTuningPlans } from './legacy-cube-tuning-plan';
import { openPinnedInstalledForgeBackend } from './pinned-forge-backend';
import {
  finalizeStageStrengthCampaignArtifacts,
  openStageStrengthCampaignArtifacts,
} from './stage-strength-artifacts';

const FORMAT_ID = 'legacy-cube-2021-08';
const MAXIMUM_TURNS = 200;
const MAXIMUM_DECISIONS = 5_000;

function parseOutput(args: readonly string[]): string {
  if (args.length !== 2 || args[0] !== '--out' || (args[1] ?? '').trim() === '') {
    throw new Error('usage: tsx packages/ui/tools/legacy-cube-tuning-campaign.ts --out <new-directory>');
  }
  return resolve(args[1]!);
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function legacyCubeTuningDecision(comparison: {
  readonly promotion: {
    readonly status: 'promote-candidate' | 'retain-baseline';
    readonly reasons: readonly string[];
  };
  readonly strength: {
    readonly independentUnits: number;
    readonly meanPairedDifference: number | null;
    readonly interval95: unknown;
    readonly byOpponent: readonly unknown[];
  };
  readonly completion: unknown;
  readonly cost: unknown;
}) {
  const blockingReasons = comparison.promotion.reasons.filter((reason) => reason !== 'not-held-out');
  const advance = blockingReasons.length === 0;
  return {
    version: 'legacy-cube-tuning-decision/v1',
    decision: advance ? 'advance-candidate-to-holdout' : 'retain-production-baseline',
    rationale: advance
      ? ['The tuning comparison met every preregistered strength, regression, and failure gate.']
      : blockingReasons,
    evidence: {
      independentUnits: comparison.strength.independentUnits,
      meanPairedDifference: comparison.strength.meanPairedDifference,
      interval95: comparison.strength.interval95,
      byOpponent: comparison.strength.byOpponent,
      completion: comparison.completion,
      cost: comparison.cost,
    },
    limitation: 'A tuning decision can only advance a candidate to untouched holdout evaluation.',
  };
}

function frozenDecks(catalog: ReturnType<typeof parsePrintedCardCatalog>): ReadonlyMap<string, DeckRef> {
  const definitions = [
    ['power', 'power'],
    ['aggro', 'pin:aggro'],
  ] as const;
  const decks = new Map(
    definitions.map(([id, policy]) => {
      const pool = draftCalibrationPool(catalog, `legacy-cube-tuning-opponent-v1/${id}`, policy).pool;
      return [id, buildCalibrationDeck(pool, `Legacy Cube frozen ${id} opponent`).ref] as const;
    }),
  );
  if (new Set([...decks.values()].map(botEvidenceSha256)).size !== decks.size) {
    throw new Error('Legacy Cube tuning opponents are not distinct');
  }
  return decks;
}

async function shutdown(backend: ObservedBackend | null): Promise<void> {
  await backend?.shutdown?.();
}

export async function runLegacyCubeTuningCampaign(repoRoot: string, outputDirectory: string): Promise<void> {
  const output = resolve(outputDirectory);
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(output);
  const forgeHome = discoverForgeHome(repoRoot);
  if (forgeHome === undefined) throw new Error('Pinned Forge distribution was not found.');
  const catalog = parsePrintedCardCatalog(
    JSON.parse(
      readFileSync(join(repoRoot, 'packages/data/data/legacy-cube-2021-card-catalog-v1.json'), 'utf8'),
    ),
  );
  if (catalog.format !== FORMAT_ID) throw new Error(`Legacy Cube catalog format drift: ${catalog.format}`);
  const scratchParent = join(repoRoot, 'out/tmp');
  mkdirSync(scratchParent, { recursive: true });
  const scratch = mkdtempSync(join(scratchParent, 'legacy-cube-tuning-'));
  let compiled: ReturnType<typeof compileInstalledForgeBridge> = null;
  let backend: ObservedBackend | null = null;
  let orphanedSnapshot: ForgeRuntimeSnapshot | null = null;
  let draftRecorder: ReturnType<typeof openStageStrengthCampaignArtifacts> | null = null;
  let builderRecorder: ReturnType<typeof openStageStrengthCampaignArtifacts> | null = null;
  try {
    compiled = compileInstalledForgeBridge({ forgeHome, outputParent: scratch });
    if (compiled === null) throw new Error('Pinned Forge bridge could not be compiled.');
    const adapterBundlePath = await bundleInstalledForgeAdapter(repoRoot, join(scratch, 'adapter'));
    const runtimeArtifact = await bundleLegacyCubeStageRuntime(repoRoot, join(scratch, 'runtime'));
    const runtime = await importLegacyCubeStageRuntime(runtimeArtifact.path);
    if (runtime.sha256 !== runtimeArtifact.sha256) {
      throw new Error('Legacy Cube stage runtime changed between build and import.');
    }
    const snapshots = join(scratch, 'snapshots');
    mkdirSync(snapshots);
    const snapshot = createForgeRuntimeSnapshot({
      forgeHome,
      bridge: { kind: 'compiled', path: compiled.classDirectory },
      adapterBundlePath,
      outputParent: snapshots,
    });
    orphanedSnapshot = snapshot;
    backend = await openPinnedInstalledForgeBackend(snapshot, FORMAT_ID);
    orphanedSnapshot = null;
    const opponents = frozenDecks(catalog);
    const gameplayPolicy = runtime.module.strongestForgeObservedPolicy;
    const nativeRuntime = {
      kind: 'native' as const,
      version: 'legacy-cube-stage-runtime/v1',
      buildSha256: runtime.sha256,
    };
    const gameplayRuntime = {
      kind: 'forge' as const,
      version: `forge-${snapshot.identity.forgeVersion}/legacy-cube-stage-v1`,
      buildSha256: sha256({
        version: 'legacy-cube-stage-forge-runtime/v1',
        forgeRuntime: snapshot.identity,
        executableBundleSha256: runtime.sha256,
      }),
    };
    const opponentPolicy = {
      policyId: `forge-default@${snapshot.identity.forgeVersion}`,
      configSha256: botEvidenceSha256({
        controller: 'engine',
        aiMode: 'Default',
        forgeRuntime: snapshot.identity,
      }),
      modelSha256: null,
      dataSha256: null,
    };
    const plans = buildLegacyCubeTuningPlans({
      catalog,
      nativeRuntime,
      gameplayRuntime,
      gameplayFeatures: forgeGameplayFeatureIdentity(gameplayPolicy),
      gameplayPolicy: forgeGameplayPolicyIdentity(gameplayPolicy),
      opponentPolicy,
      opponents,
    });
    const builderPools = new Map(
      plans.builder.schedule.map((row) => [
        row.seed,
        draftCalibrationPool(catalog, row.seed, 'power').pool.map((card) => card.physicalId),
      ]),
    );
    const manifest = {
      version: 'legacy-cube-stage-tuning-runtime/v1',
      catalog: { format: catalog.format, contentSha256: catalog.contentSha256 },
      executableBundle: { file: 'legacy-cube-stage-runtime.mjs', sha256: runtime.sha256 },
      installedAdapter: { file: 'installed-adapter.mjs', sha256: snapshot.identity.adapterSha256 },
      forgeRuntime: snapshot.identity,
      opponents: Object.fromEntries(
        [...opponents].map(([id, deck]) => [id, { deck, artifactSha256: botEvidenceSha256(deck) }]),
      ),
      builderPools: Object.fromEntries(builderPools),
      limits: { maximumTurns: MAXIMUM_TURNS, maximumDecisions: MAXIMUM_DECISIONS },
    };
    copyFileSync(
      runtimeArtifact.path,
      join(output, 'legacy-cube-stage-runtime.mjs'),
      constants.COPYFILE_EXCL,
    );
    copyFileSync(adapterBundlePath, join(output, 'installed-adapter.mjs'), constants.COPYFILE_EXCL);
    const outcomeOptions = {
      plan: plans.draft,
      gameplayPolicy,
      backends: new Map([[FORMAT_ID, backend]]),
      opponents,
      maximumTurns: MAXIMUM_TURNS,
      maximumDecisions: MAXIMUM_DECISIONS,
    };
    await runtime.module.validateForgeStageDeckOutcomeOptions(outcomeOptions);

    draftRecorder = openStageStrengthCampaignArtifacts(join(output, 'draft'), plans.draft, manifest);
    await runtime.module.executeLegacyCubeDraftStageCampaign({
      plan: plans.draft,
      catalog,
      executeOutcome: (context, deck) =>
        runtime.module.evaluateForgeStageDeckOutcome(outcomeOptions, context, deck),
      onTrial: (trial) => {
        draftRecorder!.checkpoint(trial);
        process.stdout.write(`Legacy Cube draft tuning: ${trial.unitId}/${trial.arm}\n`);
      },
    });
    draftRecorder.abort();
    draftRecorder = null;
    const draftComparison = await finalizeStageStrengthCampaignArtifacts(join(output, 'draft'));
    writeFileSync(
      join(output, 'draft', 'decision.json'),
      `${JSON.stringify(legacyCubeTuningDecision(draftComparison), null, 2)}\n`,
      {
        flag: 'wx',
      },
    );

    const builderOutcomeOptions = { ...outcomeOptions, plan: plans.builder };
    await runtime.module.validateForgeStageDeckOutcomeOptions(builderOutcomeOptions);
    builderRecorder = openStageStrengthCampaignArtifacts(join(output, 'builder'), plans.builder, manifest);
    await runtime.module.executeLegacyCubeBuilderStageCampaign({
      plan: plans.builder,
      catalog,
      pools: builderPools,
      executeOutcome: (context, deck) =>
        runtime.module.evaluateForgeStageDeckOutcome(builderOutcomeOptions, context, deck),
      onTrial: (trial) => {
        builderRecorder!.checkpoint(trial);
        process.stdout.write(`Legacy Cube builder tuning: ${trial.unitId}/${trial.arm}\n`);
      },
    });
    builderRecorder.abort();
    builderRecorder = null;
    const builderComparison = await finalizeStageStrengthCampaignArtifacts(join(output, 'builder'));
    writeFileSync(
      join(output, 'builder', 'decision.json'),
      `${JSON.stringify(legacyCubeTuningDecision(builderComparison), null, 2)}\n`,
      { flag: 'wx' },
    );
  } finally {
    draftRecorder?.abort();
    builderRecorder?.abort();
    try {
      await shutdown(backend);
    } finally {
      orphanedSnapshot?.dispose();
      compiled?.dispose();
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}

const invoked =
  process.argv[1] === undefined ? false : resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  await runLegacyCubeTuningCampaign(repoRoot, parseOutput(process.argv.slice(2)));
}
