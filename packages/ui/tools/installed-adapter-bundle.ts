/** Build the exact Node adapter artifact whose bytes are measured by qualification and admission. */
import { join } from 'node:path';
import { build } from 'vite';

export async function bundleInstalledForgeAdapter(
  workspace: string,
  outputDirectory: string,
): Promise<string> {
  await build({
    configFile: false,
    logLevel: 'error',
    resolve: {
      alias: {
        '@mtg/engine': join(workspace, 'packages/engine/src/index.ts'),
        '@mtg/dsl': join(workspace, 'packages/dsl/src/index.ts'),
      },
    },
    build: {
      outDir: outputDirectory,
      lib: {
        entry: join(workspace, 'packages/forge-export/src/observed/installed.ts'),
        formats: ['es'],
        fileName: () => 'adapter.mjs',
      },
      rollupOptions: { external: (id) => id.startsWith('node:') },
      minify: false,
    },
  });
  return join(outputDirectory, 'adapter.mjs');
}
