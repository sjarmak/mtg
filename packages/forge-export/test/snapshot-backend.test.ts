import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measureForgeRuntime } from '../src/observed/runtime-identity';
import { snapshotForgeBackend } from './support/snapshot-backend';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mtg-probe-backend-test-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function fixture() {
  mkdirSync(join(root, 'res/cardsfolder'), { recursive: true });
  mkdirSync(join(root, 'classes'));
  writeFileSync(join(root, 'forge-gui-desktop-2.0.14-jar-with-dependencies.jar'), 'fixture jar');
  writeFileSync(join(root, 'res/cardsfolder/cardsfolder.zip'), 'fixture scripts');
  writeFileSync(join(root, 'classes/ForgeBridge.class'), 'fixture bridge');
  const adapterBundlePath = join(root, 'adapter.mjs');
  writeFileSync(
    adapterBundlePath,
    `export function installedForgeBackend(options) {
    return { kind: 'observed', id: 'fixture', options };
  }`,
  );
  const inputs = {
    forgeHome: root,
    bridge: { kind: 'compiled' as const, path: join(root, 'classes') },
    adapterBundlePath,
  };
  const identity = measureForgeRuntime(inputs);
  const manifestPath = join(root, 'runtime.json');
  writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, inputs, identity }));
  return { inputs, identity, manifestPath };
}

it('loads the copied adapter with exact measured runtime paths', async () => {
  const { inputs, manifestPath } = fixture();
  expect(await snapshotForgeBackend({ timeoutMs: 1234 }, manifestPath)).toMatchObject({
    id: 'fixture',
    options: { timeoutMs: 1234, forgeHome: inputs.forgeHome, compiledBridgeClasses: inputs.bridge.path },
  });
});

it('refuses changed runtime bytes before importing the adapter', async () => {
  const { manifestPath, inputs } = fixture();
  writeFileSync(inputs.adapterBundlePath, 'throw new Error("must not import");');
  await expect(snapshotForgeBackend({}, manifestPath)).rejects.toThrow(/runtime identity mismatch/);
});

it('refuses malformed or missing manifests without falling back to the workspace', async () => {
  const { manifestPath } = fixture();
  writeFileSync(manifestPath, '{}');
  await expect(snapshotForgeBackend({}, manifestPath)).rejects.toThrow();
  await expect(snapshotForgeBackend({}, join(root, 'missing.json'))).rejects.toThrow(/ENOENT/);
});

it('refuses source bridge manifests and undeclared input overrides', async () => {
  const { manifestPath, inputs, identity } = fixture();
  writeFileSync(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      inputs: { ...inputs, bridge: { ...inputs.bridge, kind: 'source' } },
      identity,
    }),
  );
  await expect(snapshotForgeBackend({}, manifestPath)).rejects.toThrow();
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  writeFileSync(manifestPath, JSON.stringify({ ...parsed, inputs: { ...inputs, resolveCustomSet: true } }));
  await expect(snapshotForgeBackend({}, manifestPath)).rejects.toThrow();
});
