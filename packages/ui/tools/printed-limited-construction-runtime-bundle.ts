/** Build and reload the exact bytes used for ISD construction and downstream play. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';
import type { ForgeObservedDecisionPolicy } from '@mtg/forge-export';
import type {
  executePrintedLimitedConstructionCampaign,
  runPrintedLimitedConstructionCampaign,
} from './printed-limited-construction-campaign';
import { workspacePackageAliases } from './workspace-package-aliases';

export interface PrintedLimitedConstructionRuntimeModule {
  readonly strongestForgeObservedPolicy: ForgeObservedDecisionPolicy;
  readonly executePrintedLimitedConstructionCampaign: typeof executePrintedLimitedConstructionCampaign;
  readonly runPrintedLimitedConstructionCampaign: typeof runPrintedLimitedConstructionCampaign;
}

export async function bundlePrintedLimitedConstructionRuntime(
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
        entry: join(workspace, 'packages/ui/tools/printed-limited-construction-runtime.ts'),
        formats: ['es'],
        fileName: () => 'printed-limited-construction-runtime.mjs',
      },
      rollupOptions: { external: (id) => id.startsWith('node:') },
      minify: false,
    },
  });
  const path = join(outputDirectory, 'printed-limited-construction-runtime.mjs');
  return { path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
}

export async function importPrintedLimitedConstructionRuntime(
  path: string,
): Promise<{ readonly sha256: string; readonly module: PrintedLimitedConstructionRuntimeModule }> {
  const bytes = readFileSync(path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const loaded = (await import(
    `data:text/javascript;base64,${bytes.toString('base64')}`
  )) as Partial<PrintedLimitedConstructionRuntimeModule>;
  if (
    typeof loaded.executePrintedLimitedConstructionCampaign !== 'function' ||
    typeof loaded.runPrintedLimitedConstructionCampaign !== 'function' ||
    loaded.strongestForgeObservedPolicy === undefined
  ) {
    throw new Error('Printed Limited construction runtime artifact has an incomplete export surface.');
  }
  return { sha256, module: loaded as PrintedLimitedConstructionRuntimeModule };
}
