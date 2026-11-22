import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tryAcquire } from '../../../slice/tools/test-load/host-lock';
import { runPrintedObservedSweep } from '../../tools/printed-observed-sweep';

const tool = fileURLToPath(new URL('../../tools/printed-observed-sweep-cli.ts', import.meta.url));

vi.mock('../../tools/printed-observed-sweep', () => ({ runPrintedObservedSweep: vi.fn() }));

it('requires explicit immutable inputs and bounded execution arguments', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', tool], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Usage: printed-observed-sweep');
  expect(result.stdout).toBe('');
});

it('rejects a catalog target count outside the catalog-coverage strategy', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      tool,
      '--format',
      'format.json',
      '--catalog',
      'catalog.json',
      '--mode',
      'sealed',
      '--catalog-targets-per-deck',
      '4',
      '--seed-start',
      '0',
      '--count',
      '1',
      '--output',
      'out',
      '--timeout-ms',
      '1000',
      '--maximum-turns',
      '1',
      '--decision-budget',
      '1',
    ],
    { encoding: 'utf8', timeout: 10_000 },
  );

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    'catalog-targets-per-deck requires catalog-coverage and an integer from 1 to 16',
  );
  expect(result.stderr).not.toContain('ENOENT');
});

// mtg-b9eom review item 2: runPrintedObservedSweep drives the installed
// Forge diagnostic backend, so this CLI wraps that call in withForgeLock.
// Unlike printed-probe-cli.ts, this file has no exported main — it runs at
// import time — so the wrap is checked in-process with the sweep runner
// stubbed and the script imported fresh, the way set-icon.test.ts imports a
// module fresh after stubbing what it reads.
describe('the lock wrapping the in-process sweep call', () => {
  let dir = '';
  let path = '';
  const priorHome = process.env.MTG_FORGE_LOCK_HOME;
  const priorArgv = process.argv;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mtg-observed-sweep-cli-lock-test-'));
    path = join(dir, 'gc-forge-run.lock');
    process.env.MTG_FORGE_LOCK_HOME = path;
    vi.resetModules();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (priorHome === undefined) delete process.env.MTG_FORGE_LOCK_HOME;
    else process.env.MTG_FORGE_LOCK_HOME = priorHome;
    process.argv = priorArgv;
    vi.resetModules();
  });

  it('holds the host-wide Forge lock while the sweep runs, and releases it after', async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'mtg-observed-sweep-cli-fixture-'));
    const format = join(fixtureDir, 'format.json');
    const catalog = join(fixtureDir, 'catalog.json');
    const output = join(fixtureDir, 'out');
    writeFileSync(format, '{"format":"fixture"}');
    writeFileSync(catalog, '{"catalog":"fixture"}');

    let heldDuringCall = false;
    vi.mocked(runPrintedObservedSweep).mockImplementation(async () => {
      heldDuringCall = tryAcquire(path, 'someone else', Date.now()).acquired === false;
      return { receipts: [] } as never;
    });

    process.argv = [
      process.execPath,
      tool,
      '--format',
      format,
      '--catalog',
      catalog,
      '--mode',
      'sealed',
      '--seed-start',
      '0',
      '--count',
      '1',
      '--output',
      output,
      '--timeout-ms',
      '1000',
      '--maximum-turns',
      '1',
      '--decision-budget',
      '1',
    ];
    await import('../../tools/printed-observed-sweep-cli');

    expect(heldDuringCall).toBe(true);
    expect(tryAcquire(path, 'someone else', Date.now()).acquired).toBe(true);
    rmSync(fixtureDir, { recursive: true, force: true });
  });
});
