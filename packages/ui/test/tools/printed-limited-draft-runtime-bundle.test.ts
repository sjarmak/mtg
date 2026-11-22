import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  bundlePrintedLimitedDraftRuntime,
  importPrintedLimitedDraftRuntime,
} from '../../tools/printed-limited-draft-runtime-bundle';

const outputs: string[] = [];
afterEach(() => outputs.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

it('builds and imports the exact hashed draft and gameplay runtime', async () => {
  const output = mkdtempSync(join(tmpdir(), 'mtg-printed-draft-runtime-'));
  outputs.push(output);
  const artifact = await bundlePrintedLimitedDraftRuntime(resolve('.'), output);
  const loaded = await importPrintedLimitedDraftRuntime(artifact.path);
  expect(loaded.sha256).toBe(artifact.sha256);
  expect(typeof loaded.module.executePrintedLimitedDraftCampaign).toBe('function');
  expect(typeof loaded.module.runPrintedLimitedDraftCampaign).toBe('function');
  expect(typeof loaded.module.runPrintedLimitedDirectDraftCampaign).toBe('function');
  expect(loaded.module.strongestForgeObservedPolicy.identity.policyId).toContain('strongest');
});
