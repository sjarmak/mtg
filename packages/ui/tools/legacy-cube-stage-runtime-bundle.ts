/** Build and reload the exact Cube draft, builder, and downstream gameplay bytes. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';
import type { ForgeObservedDecisionPolicy } from '@mtg/forge-export';
import type {
  evaluateForgeStageDeckOutcome,
  validateForgeStageDeckOutcomeOptions,
} from './forge-stage-deck-outcome';
import type {
  executeLegacyCubeBuilderStageCampaign,
  executeLegacyCubeDraftStageCampaign,
  runLegacyCubeBuilderStageCampaign,
  runLegacyCubeDraftStageCampaign,
} from './legacy-cube-stage-campaign';
import { workspacePackageAliases } from './workspace-package-aliases';

export interface LegacyCubeStageRuntimeModule {
  readonly strongestForgeObservedPolicy: ForgeObservedDecisionPolicy;
  readonly executeLegacyCubeDraftStageCampaign: typeof executeLegacyCubeDraftStageCampaign;
  readonly executeLegacyCubeBuilderStageCampaign: typeof executeLegacyCubeBuilderStageCampaign;
  readonly runLegacyCubeDraftStageCampaign: typeof runLegacyCubeDraftStageCampaign;
  readonly runLegacyCubeBuilderStageCampaign: typeof runLegacyCubeBuilderStageCampaign;
  readonly evaluateForgeStageDeckOutcome: typeof evaluateForgeStageDeckOutcome;
  readonly validateForgeStageDeckOutcomeOptions: typeof validateForgeStageDeckOutcomeOptions;
}

export async function bundleLegacyCubeStageRuntime(
  workspace: string,
  outputDirectory: string,
): Promise<{ readonly path: string; readonly sha256: string }> {
  await build({
    configFile: false,
    logLevel: 'error',
    resolve: {
      alias: workspacePackageAliases(workspace, [
        {
          find: '@mtg/forge-export',
          replacement: join(workspace, 'packages/forge-export/src/campaign-runtime.ts'),
        },
      ]),
    },
    build: {
      outDir: outputDirectory,
      emptyOutDir: false,
      lib: {
        entry: join(workspace, 'packages/ui/tools/legacy-cube-stage-runtime.ts'),
        formats: ['es'],
        fileName: () => 'legacy-cube-stage-runtime.mjs',
      },
      rollupOptions: { external: (id) => id.startsWith('node:') },
      minify: false,
    },
  });
  const path = join(outputDirectory, 'legacy-cube-stage-runtime.mjs');
  return { path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
}

export async function importLegacyCubeStageRuntime(path: string): Promise<{
  readonly sha256: string;
  readonly module: LegacyCubeStageRuntimeModule;
}> {
  const bytes = readFileSync(path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const loaded = (await import(
    `data:text/javascript;base64,${bytes.toString('base64')}`
  )) as Partial<LegacyCubeStageRuntimeModule>;
  if (
    typeof loaded.executeLegacyCubeDraftStageCampaign !== 'function' ||
    typeof loaded.executeLegacyCubeBuilderStageCampaign !== 'function' ||
    typeof loaded.runLegacyCubeDraftStageCampaign !== 'function' ||
    typeof loaded.runLegacyCubeBuilderStageCampaign !== 'function' ||
    typeof loaded.evaluateForgeStageDeckOutcome !== 'function' ||
    typeof loaded.validateForgeStageDeckOutcomeOptions !== 'function' ||
    loaded.strongestForgeObservedPolicy === undefined
  ) {
    throw new Error('Legacy Cube stage runtime artifact has an incomplete export surface.');
  }
  return { sha256, module: loaded as LegacyCubeStageRuntimeModule };
}
