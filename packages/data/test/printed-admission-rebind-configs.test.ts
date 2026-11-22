import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe('printed admission rebind configs', () => {
  it('reconstructs Momir Basic scenario and match test files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'momir-rebind-configs-'));
    directories.push(directory);

    execFileSync(
      process.execPath,
      ['packages/data/tools/printed-admission-rebind-configs.mjs', 'momir-basic', directory],
      { cwd: process.cwd() },
    );

    const scenario = JSON.parse(readFileSync(join(directory, 'scenario.json'), 'utf8'));
    const match = JSON.parse(readFileSync(join(directory, 'match.json'), 'utf8'));

    expect(scenario.probes.map((probe: { testFile: string }) => probe.testFile)).toEqual([
      'packages/forge-export/test/observed-m11-contract-witness.integration.test.ts',
      'packages/forge-export/test/observed-m11-contract-witness.integration.test.ts',
    ]);
    expect(match.probes.map((probe: { testFile: string }) => probe.testFile)).toEqual([
      'packages/forge-export/test/bridge-momir.integration.test.ts',
      'packages/forge-export/test/bridge-momir.integration.test.ts',
    ]);
  });

  it('reconstructs Zendikar scenario and match test files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zen-rebind-configs-'));
    directories.push(directory);

    execFileSync(
      process.execPath,
      ['packages/data/tools/printed-admission-rebind-configs.mjs', 'zen', directory],
      { cwd: process.cwd() },
    );

    const scenario = JSON.parse(readFileSync(join(directory, 'scenario.json'), 'utf8'));
    const match = JSON.parse(readFileSync(join(directory, 'match.json'), 'utf8'));

    expect(scenario.probes.map((probe: { testFile: string }) => probe.testFile)).toEqual([
      'packages/forge-export/test/observed-zen-contract-witness.integration.test.ts',
      'packages/forge-export/test/observed-zen-contract-witness.integration.test.ts',
    ]);
    expect(match.probes.map((probe: { testFile: string }) => probe.testFile)).toEqual([
      'packages/forge-export/test/observed-zen-mulligan-engine.integration.test.ts',
      'packages/forge-export/test/observed-zen-match-local.integration.test.ts',
      'packages/forge-export/test/observed-zen-match-engine.integration.test.ts',
      'packages/forge-export/test/observed-zen-start-engine.integration.test.ts',
    ]);
  });

  it('reconstructs Worldwake scenario and match test files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'wwk-rebind-configs-'));
    directories.push(directory);

    execFileSync(
      process.execPath,
      ['packages/data/tools/printed-admission-rebind-configs.mjs', 'wwk', directory],
      { cwd: process.cwd() },
    );

    const scenario = JSON.parse(readFileSync(join(directory, 'scenario.json'), 'utf8'));
    const match = JSON.parse(readFileSync(join(directory, 'match.json'), 'utf8'));

    expect(scenario.probes.map((probe: { testFile: string }) => probe.testFile)).toEqual([
      'packages/forge-export/test/observed-wwk-contract-witness.integration.test.ts',
      'packages/forge-export/test/observed-wwk-contract-witness.integration.test.ts',
    ]);
    expect(match.probes.map((probe: { testFile: string }) => probe.testFile)).toEqual([
      'packages/forge-export/test/observed-wwk-mulligan-engine.integration.test.ts',
      'packages/forge-export/test/observed-wwk-match-local.integration.test.ts',
      'packages/forge-export/test/observed-wwk-match-engine.integration.test.ts',
      'packages/forge-export/test/observed-wwk-start-engine.integration.test.ts',
    ]);
  });
});
