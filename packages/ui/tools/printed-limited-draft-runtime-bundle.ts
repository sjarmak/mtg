/** Build and reload the exact bytes used for ISD drafting and downstream play. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';
import type { ForgeObservedDecisionPolicy } from '@mtg/forge-export';
import type {
  executePrintedLimitedDraftCampaign,
  runPrintedLimitedDraftCampaign,
} from './printed-limited-draft-campaign';
import type { runPrintedLimitedDirectDraftCampaign } from './printed-limited-direct-draft-campaign';
import { workspacePackageAliases } from './workspace-package-aliases';

export interface PrintedLimitedDraftRuntimeModule {
  readonly strongestForgeObservedPolicy: ForgeObservedDecisionPolicy;
  readonly executePrintedLimitedDraftCampaign: typeof executePrintedLimitedDraftCampaign;
  readonly runPrintedLimitedDraftCampaign: typeof runPrintedLimitedDraftCampaign;
  readonly runPrintedLimitedDirectDraftCampaign: typeof runPrintedLimitedDirectDraftCampaign;
}

export async function bundlePrintedLimitedDraftRuntime(
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
        entry: join(workspace, 'packages/ui/tools/printed-limited-draft-runtime.ts'),
        formats: ['es'],
        fileName: () => 'printed-limited-draft-runtime.mjs',
      },
      rollupOptions: { external: (id) => id.startsWith('node:') },
      minify: false,
    },
  });
  const path = join(outputDirectory, 'printed-limited-draft-runtime.mjs');
  return { path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
}

export async function importPrintedLimitedDraftRuntime(path: string) {
  const bytes = readFileSync(path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const loaded = (await import(
    `data:text/javascript;base64,${bytes.toString('base64')}`
  )) as Partial<PrintedLimitedDraftRuntimeModule>;
  if (
    typeof loaded.executePrintedLimitedDraftCampaign !== 'function' ||
    typeof loaded.runPrintedLimitedDraftCampaign !== 'function' ||
    typeof loaded.runPrintedLimitedDirectDraftCampaign !== 'function' ||
    loaded.strongestForgeObservedPolicy === undefined
  ) {
    throw new Error('Printed Limited draft runtime artifact has an incomplete export surface.');
  }
  return { sha256, module: loaded as PrintedLimitedDraftRuntimeModule };
}
