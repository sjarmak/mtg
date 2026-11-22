import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  bundleLegacyCubeStageRuntime,
  importLegacyCubeStageRuntime,
} from '../../tools/legacy-cube-stage-runtime-bundle';

const outputs: string[] = [];
afterEach(() => outputs.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

it('builds and imports the exact hashed Cube draft, builder, and gameplay runtime', async () => {
  const output = mkdtempSync(join(tmpdir(), 'mtg-legacy-cube-stage-runtime-'));
  outputs.push(output);
  const artifact = await bundleLegacyCubeStageRuntime(resolve('.'), output);
  const loaded = await importLegacyCubeStageRuntime(artifact.path);

  expect(loaded.sha256).toBe(artifact.sha256);
  expect(typeof loaded.module.runLegacyCubeDraftStageCampaign).toBe('function');
  expect(typeof loaded.module.runLegacyCubeBuilderStageCampaign).toBe('function');
  expect(typeof loaded.module.executeLegacyCubeDraftStageCampaign).toBe('function');
  expect(typeof loaded.module.executeLegacyCubeBuilderStageCampaign).toBe('function');
  expect(typeof loaded.module.evaluateForgeStageDeckOutcome).toBe('function');
  expect(loaded.module.strongestForgeObservedPolicy.identity.policyId).toContain('strongest');
});
