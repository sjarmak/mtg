import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  bundleForgeCampaignRuntime,
  importForgeCampaignRuntimeArtifact,
} from '../../tools/forge-campaign-runtime-bundle';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mtg-forge-campaign-bundle-test-'));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

it('builds one measured artifact containing all policies and the exact campaign runner', async () => {
  const artifact = await bundleForgeCampaignRuntime(resolve('.'), join(root, 'bundle'));
  const bytes = readFileSync(artifact.path);
  const loaded = await importForgeCampaignRuntimeArtifact(artifact.path);

  expect(artifact.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  expect(loaded.sha256).toBe(artifact.sha256);
  expect(loaded.module.forgeObservedCoveragePolicyV8).toMatchObject({
    identity: { policyId: 'forge-observed-coverage-baseline', policyVersion: 8 },
  });
  expect(loaded.module.forgeObservedLegalBaselinePolicy).toMatchObject({
    identity: { policyId: 'forge-observed-legal-baseline', policyVersion: 31 },
  });
  expect(loaded.module.strongestForgeObservedPolicy).toMatchObject({
    identity: { policyId: 'forge-observed-strongest-play', policyVersion: 49 },
  });
  expect(loaded.module.executeForgeBotStrengthCampaign).toBeTypeOf('function');
  expect(loaded.module.runForgeBotStrengthCampaign).toBeTypeOf('function');
});
