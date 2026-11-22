import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { printedProbeMain } from '../../tools/printed-probe-cli';
import { runPrintedProbeSuite } from '../../tools/printed-probe-run';
import type * as ProbeRunnerModule from '../../tools/printed-probe-run';
import { tryAcquire } from '../../../slice/tools/test-load/host-lock';

vi.mock('../../tools/printed-probe-run', async (original) => ({
  ...(await original<typeof ProbeRunnerModule>()),
  runPrintedProbeSuite: vi.fn(),
}));
const roots: string[] = [];
let lockDir = '';
let lockPath = '';
const priorForgeLockHome = process.env.MTG_FORGE_LOCK_HOME;
beforeEach(() => {
  lockDir = mkdtempSync(join(tmpdir(), 'mtg-printed-probe-cli-lock-test-'));
  lockPath = join(lockDir, 'gc-forge-run.lock');
  process.env.MTG_FORGE_LOCK_HOME = lockPath;
});
afterEach(async () => {
  vi.resetAllMocks();
  rmSync(lockDir, { recursive: true, force: true });
  if (priorForgeLockHome === undefined) delete process.env.MTG_FORGE_LOCK_HOME;
  else process.env.MTG_FORGE_LOCK_HOME = priorForgeLockHome;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const probe = {
  id: 'fixture-local',
  scope: 'card',
  controller: 'local',
  cardIds: ['fixture'],
  decisionFamilies: ['fixture'],
  assertions: ['fixture assertion'],
  testFile: 'test/fixture.test.ts',
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mtg-probe-cli-'));
  roots.push(root);
  await writeFile(join(root, 'format.json'), '{"format":"fixture"}');
  await writeFile(join(root, 'catalog.json'), '{"catalog":"fixture"}');
  const config = {
    schemaVersion: 1,
    workspace: '.',
    format: 'format.json',
    catalogs: ['catalog.json'],
    probes: [probe],
  };
  await writeFile(join(root, 'config.json'), JSON.stringify(config));
  const args = [
    '--config',
    join(root, 'config.json'),
    '--out',
    join(root, 'evidence'),
    '--timeout-ms',
    '180000',
  ];
  const stdout = vi.fn();
  const stderr = vi.fn();
  return { root, config, args, io: { stdout, stderr } };
}

it('loads explicit local files relative to the config workspace and retains the requested output', async () => {
  const { root, args, io } = await fixture();
  vi.mocked(runPrintedProbeSuite).mockResolvedValue({
    subject: {} as never,
    receipts: [],
    qualification: 'unproven',
  });
  expect(await printedProbeMain(args, io)).toBe(0);
  expect(runPrintedProbeSuite).toHaveBeenCalledWith({
    workspace: root,
    format: { format: 'fixture' },
    catalogs: [{ catalog: 'fixture' }],
    probes: [probe],
    outputDirectory: join(root, 'evidence'),
    timeoutMs: 180000,
  });
  expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('unproven'));
  expect(await readFile(join(root, 'config.json'), 'utf8')).toContain('fixture-local');
  expect(io.stderr).not.toHaveBeenCalled();
});

// mtg-b9eom review item 2: runPrintedProbeSuite compiles and drives the
// installed Forge bridge, so this CLI wraps that call in withForgeLock. A
// stub in place of the real bridge, checked the way with-forge-lock.test.ts
// checks its own wrapper: the lock is held while the mock runs and released
// once it returns.
it('holds the host-wide Forge lock while running the probe suite, and releases it after', async () => {
  const { args, io } = await fixture();
  let heldDuringCall = false;
  vi.mocked(runPrintedProbeSuite).mockImplementation(async () => {
    heldDuringCall = tryAcquire(lockPath, 'someone else', Date.now()).acquired === false;
    return { subject: {} as never, receipts: [], qualification: 'unproven' };
  });
  expect(await printedProbeMain(args, io)).toBe(0);
  expect(heldDuringCall).toBe(true);
  expect(tryAcquire(lockPath, 'someone else', Date.now()).acquired).toBe(true);
});

it('loads an optional reviewed script coverage plan before execution', async () => {
  const { root, config, args, io } = await fixture();
  const coveragePlan = { schemaVersion: 1, kind: 'printed-script-coverage-plan', scripts: [] };
  await writeFile(join(root, 'coverage.json'), JSON.stringify(coveragePlan));
  await writeFile(join(root, 'config.json'), JSON.stringify({ ...config, coveragePlan: 'coverage.json' }));
  vi.mocked(runPrintedProbeSuite).mockResolvedValue({
    subject: {} as never,
    receipts: [],
    qualification: 'unproven',
  });
  expect(await printedProbeMain(args, io)).toBe(0);
  expect(runPrintedProbeSuite).toHaveBeenCalledWith(expect.objectContaining({ coveragePlan }));
  vi.mocked(runPrintedProbeSuite).mockClear();
  await writeFile(join(root, 'coverage.json'), JSON.stringify({ ...coveragePlan, schemaVersion: 2 }));
  expect(await printedProbeMain(args, io)).toBe(1);
  expect(runPrintedProbeSuite).not.toHaveBeenCalled();
});

it('loads controller contracts through their confined portable bundle', async () => {
  const { root, config, args, io } = await fixture();
  await writeFile(join(root, 'contract.json'), '{"contract":"fixture"}');
  await writeFile(
    join(root, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 1,
      kind: 'printed-controller-contract-bundle',
      contracts: [{ id: 'fixture', path: 'contract.json', decisionFamilies: ['fixture'] }],
    }),
  );
  await writeFile(join(root, 'config.json'), JSON.stringify({ ...config, controllerContractBundle: '.' }));
  vi.mocked(runPrintedProbeSuite).mockResolvedValue({
    subject: {} as never,
    receipts: [],
    qualification: 'unproven',
  });
  expect(await printedProbeMain(args, io)).toBe(0);
  const call = vi.mocked(runPrintedProbeSuite).mock.calls[0]?.[0];
  expect(call?.controllerContracts).toHaveLength(1);
  expect(call?.controllerContracts?.[0]?.bytes.toString()).toBe('{"contract":"fixture"}');
  expect(call?.controllerContracts?.[0]?.readEvidence('contract.json').toString()).toBe(
    '{"contract":"fixture"}',
  );
  expect(() => call?.controllerContracts?.[0]?.readEvidence('../outside.json')).toThrow('escapes bundle');
});

it.each([
  [],
  ['--help', '--out', 'x'],
  ['--config', 'x'],
  ['--config', 'x', '--out', 'y', '--timeout-ms', 'NaN'],
  ['--config', 'x', '--out', 'y', '--timeout-ms', '999'],
  ['--config', 'x', '--out', 'y', '--timeout-ms', '600001'],
  ['--config', 'x', '--out', 'y', '--timeout-ms', '1000', '--out', 'z'],
  ['--config', 'x', '--out', 'y', '--timeout-ms', '1000', '--enable'],
  ['--config', 'x', '--out', 'y', '--timeout-ms', '1000', 'extra'],
])('refuses incomplete or ambiguous arguments before execution: %j', async (...args) => {
  const io = { stdout: vi.fn(), stderr: vi.fn() };
  expect(await printedProbeMain(args, io)).toBe(1);
  expect(io.stderr).toHaveBeenCalled();
  expect(runPrintedProbeSuite).not.toHaveBeenCalled();
});

it('prints help without reading files or starting Forge', async () => {
  const io = { stdout: vi.fn(), stderr: vi.fn() };
  expect(await printedProbeMain(['--help'], io)).toBe(0);
  expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('--config'));
  expect(runPrintedProbeSuite).not.toHaveBeenCalled();
});

it.each([{ extra: true }, { schemaVersion: 2 }, { probes: [] }, { catalogs: [] }, { workspace: '' }])(
  'refuses malformed configuration without execution: %j',
  async (change) => {
    const { root, config, args, io } = await fixture();
    await writeFile(join(root, 'config.json'), JSON.stringify({ ...config, ...change }));
    expect(await printedProbeMain(args, io)).toBe(1);
    expect(runPrintedProbeSuite).not.toHaveBeenCalled();
    expect(io.stderr).toHaveBeenCalled();
  },
);

it('propagates producer failure without reporting success or removing evidence', async () => {
  const { root, args, io } = await fixture();
  const evidence = join(root, 'diagnostic.json');
  await writeFile(evidence, 'retained');
  vi.mocked(runPrintedProbeSuite).mockRejectedValue(new Error('Probe failed: diagnostic.json'));
  expect(await printedProbeMain(args, io)).toBe(1);
  expect(io.stdout).not.toHaveBeenCalled();
  expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining('Probe failed: diagnostic.json'));
  expect(await readFile(evidence, 'utf8')).toBe('retained');
});

it('refuses missing and malformed JSON inputs before execution', async () => {
  const { root, args, io } = await fixture();
  await writeFile(join(root, 'format.json'), 'not json');
  expect(await printedProbeMain(args, io)).toBe(1);
  await rm(join(root, 'config.json'));
  expect(await printedProbeMain(args, io)).toBe(1);
  expect(runPrintedProbeSuite).not.toHaveBeenCalled();
});

it('the executable prints help and exits nonzero for missing required arguments', async () => {
  const command = ['--import', 'tsx', 'packages/ui/tools/printed-probe-cli.ts'];
  const execute = promisify(execFile);
  const help = await execute(process.execPath, [...command, '--help'], { timeout: 10000 });
  expect(help.stdout).toContain('does not enable play');
  expect(help.stderr).toBe('');
  await expect(execute(process.execPath, command, { timeout: 10000 })).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining('Printed probe run failed'),
  });
}, 25000);

it('reports non-Error producer failures and uses the default output streams', async () => {
  const { args } = await fixture();
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  try {
    expect(await printedProbeMain(['--help'])).toBe(0);
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    vi.mocked(runPrintedProbeSuite).mockRejectedValue('disconnected');
    expect(await printedProbeMain(args)).toBe(1);
    expect(stderr).toHaveBeenCalledWith('Printed probe run failed: disconnected\n');
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
});
