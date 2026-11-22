/** Build and hash the exact policy/campaign code executed by a Forge strength run. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';
import type { ForgeObservedDecisionPolicy } from '@mtg/forge-export';
import type { executeForgeBotStrengthCampaign, runForgeBotStrengthCampaign } from '@mtg/metrics';
import { workspacePackageAliases } from './workspace-package-aliases';

export interface ForgeCampaignRuntimeArtifact {
  readonly path: string;
  readonly sha256: string;
}

export interface ForgeCampaignRuntimeModule {
  readonly forgeObservedCoveragePolicyV8: ForgeObservedDecisionPolicy;
  readonly forgeObservedLegalBaselinePolicy: ForgeObservedDecisionPolicy;
  readonly strongestForgeObservedPolicy: ForgeObservedDecisionPolicy;
  readonly executeForgeBotStrengthCampaign: typeof executeForgeBotStrengthCampaign;
  readonly runForgeBotStrengthCampaign: typeof runForgeBotStrengthCampaign;
}

export async function bundleForgeCampaignRuntime(
  workspace: string,
  outputDirectory: string,
): Promise<ForgeCampaignRuntimeArtifact> {
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
        entry: join(workspace, 'packages/metrics/src/forge-campaign-runtime.ts'),
        formats: ['es'],
        fileName: () => 'campaign-runtime.mjs',
      },
      rollupOptions: { external: (id) => id.startsWith('node:') },
      minify: false,
    },
  });
  const path = join(outputDirectory, 'campaign-runtime.mjs');
  return { path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
}

/** Import the same byte array that is hashed, avoiding a hash-then-open race. */
export async function importForgeCampaignRuntimeArtifact(path: string): Promise<{
  readonly sha256: string;
  readonly module: ForgeCampaignRuntimeModule;
}> {
  const bytes = readFileSync(path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const source = `data:text/javascript;base64,${bytes.toString('base64')}`;
  const loaded = (await import(source)) as Partial<ForgeCampaignRuntimeModule>;
  if (
    loaded.forgeObservedCoveragePolicyV8 === undefined ||
    loaded.forgeObservedLegalBaselinePolicy === undefined ||
    loaded.strongestForgeObservedPolicy === undefined ||
    typeof loaded.executeForgeBotStrengthCampaign !== 'function' ||
    typeof loaded.runForgeBotStrengthCampaign !== 'function'
  ) {
    throw new Error('Forge campaign runtime artifact has an incomplete export surface.');
  }
  return { sha256, module: loaded as ForgeCampaignRuntimeModule };
}
