import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  bundlePrintedLimitedConstructionRuntime,
  importPrintedLimitedConstructionRuntime,
} from '../../tools/printed-limited-construction-runtime-bundle';

const outputs: string[] = [];
afterEach(() => outputs.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

it('builds and imports the exact hashed construction and gameplay runtime', async () => {
  const output = mkdtempSync(join(tmpdir(), 'mtg-printed-construction-runtime-'));
  outputs.push(output);
  const artifact = await bundlePrintedLimitedConstructionRuntime(resolve('.'), output);
  const loaded = await importPrintedLimitedConstructionRuntime(artifact.path);

  expect(loaded.sha256).toBe(artifact.sha256);
  expect(typeof loaded.module.executePrintedLimitedConstructionCampaign).toBe('function');
  expect(typeof loaded.module.runPrintedLimitedConstructionCampaign).toBe('function');
  expect(loaded.module.strongestForgeObservedPolicy.identity.policyId).toContain('strongest');
});
