import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { build } from 'vite';
import { workspacePackageAliases } from '../../tools/workspace-package-aliases';

const outputs: string[] = [];
afterEach(() => outputs.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

it('builds @mtg packages from the requested workspace instead of node_modules', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'mtg-workspace-aliases-'));
  outputs.push(workspace);
  mkdirSync(join(workspace, 'packages/engine/src'), { recursive: true });
  writeFileSync(
    join(workspace, 'packages/engine/src/index.ts'),
    "export const workspaceMarker = 'isolated-workspace-engine';\n",
  );
  writeFileSync(
    join(workspace, 'entry.ts'),
    "import { workspaceMarker } from '@mtg/engine'; export { workspaceMarker };\n",
  );

  await build({
    configFile: false,
    logLevel: 'error',
    resolve: { alias: workspacePackageAliases(workspace) },
    build: {
      outDir: join(workspace, 'dist'),
      lib: { entry: join(workspace, 'entry.ts'), formats: ['es'], fileName: () => 'entry.mjs' },
    },
  });

  expect(readFileSync(join(workspace, 'dist/entry.mjs'), 'utf8')).toContain('isolated-workspace-engine');
});
