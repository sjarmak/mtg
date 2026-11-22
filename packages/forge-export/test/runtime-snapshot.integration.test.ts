/** Real process launch from copied artifacts; not a full-format compatibility claim. */
import { expect, it } from 'vitest';
import { build } from 'vite';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { compileInstalledForgeBridge } from '../src/observed/installed';
import { findForgeInstall } from '../src/install';
import { createForgeRuntimeSnapshot } from '../src/observed/runtime-snapshot';
import { measureForgeRuntime } from '../src/observed/runtime-identity';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
forgeIt(
  'launches the copied adapter, compiled bridge, JAR and resources as one measured runtime',
  async () => {
    const install = findForgeInstall();
    if (install === null) throw new Error('Required installed Forge is absent');
    const compiled = compileInstalledForgeBridge({ forgeHome: install.home });
    if (compiled === null) throw new Error('Required compiled Forge bridge is absent');
    const root = mkdtempSync(join(tmpdir(), 'mtg-snapshot-launch-test-'));
    let snapshot: ReturnType<typeof createForgeRuntimeSnapshot> | undefined;
    try {
      await build({
        configFile: false,
        logLevel: 'error',
        resolve: {
          alias: {
            '@mtg/engine': resolve('packages/engine/src/index.ts'),
            '@mtg/dsl': resolve('packages/dsl/src/index.ts'),
          },
        },
        build: {
          outDir: join(root, 'bundle'),
          lib: {
            entry: resolve('packages/forge-export/src/observed/installed.ts'),
            formats: ['es'],
            fileName: () => 'adapter.mjs',
          },
          rollupOptions: { external: (id) => id.startsWith('node:') },
          minify: false,
        },
      });
      snapshot = createForgeRuntimeSnapshot({
        forgeHome: install.home,
        bridge: { kind: 'compiled', path: compiled.classDirectory },
        adapterBundlePath: join(root, 'bundle/adapter.mjs'),
        outputParent: root,
      });
      // Prove no source bridge or source bundle is required after snapshotting.
      compiled.dispose();
      rmSync(join(root, 'bundle'), { recursive: true, force: true });
      const result = execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          String.raw`
      import { pathToFileURL } from 'node:url';
      const inputs = JSON.parse(process.argv[1]);
      const { installedForgeBackend } = await import(pathToFileURL(inputs.adapterBundlePath).href);
      const backend = installedForgeBackend({ forgeHome: inputs.forgeHome, compiledBridgeClasses: inputs.bridge.path, timeoutMs: 60000 });
      if (backend === null) throw new Error('Snapshot Forge not found');
      let session;
      try {
        const opened = await backend.open({
          content: { kind: 'printed', format: 'akh-hou' },
          seats: [
            { name: 'Local', controller: 'local', deck: { name: 'local', cards: [{ name: 'Forest', count: 40 }] } },
            { name: 'Bot', controller: 'engine', deck: { name: 'bot', cards: [{ name: 'Forest', count: 40 }] } },
          ], seed: 'snapshot-launch-v1', maximumTurns: 1,
        });
        if (!opened.ok) throw new Error(opened.error.message);
        session = opened.session;
        console.log(JSON.stringify({ backend: session.backend, status: session.status, localSeats: session.localSeats, botHand: session.view.seats[1].hand, decision: session.decision?.kind }));
      } finally {
        await session?.close();
        await backend.shutdown?.();
      }
    `,
          JSON.stringify(snapshot.inputs),
        ],
        { encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024 },
      );
      expect(JSON.parse(result.trim())).toMatchObject({
        backend: 'forge-2.0.14',
        status: 'awaiting',
        localSeats: [0],
        botHand: null,
      });
      expect(measureForgeRuntime(snapshot.inputs)).toEqual(snapshot.identity);
    } finally {
      snapshot?.dispose();
      compiled.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  },
  180000,
);
