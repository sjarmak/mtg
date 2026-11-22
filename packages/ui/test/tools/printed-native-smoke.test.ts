import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runPrintedNativeSmoke } from '../../tools/printed-native-smoke';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});
async function input(mode: 'draft' | 'sealed' = 'sealed') {
  const root = await mkdtemp(join(tmpdir(), 'mtg-printed-smoke-test-'));
  roots.push(root);
  const read = async (name: string): Promise<unknown> =>
    JSON.parse(
      await readFile(new URL(`../../../data/data/akh-hou/${name}`, import.meta.url), 'utf8'),
    ) as unknown;
  return {
    format: await read('akh-hou-limited-format-v1.json'),
    catalogs: await Promise.all(['akh', 'hou', 'mp2'].map((code) => read(`${code}-printed-catalog-v1.json`))),
    mode,
    seed: 42,
    outputDirectory: join(root, 'run'),
    timeoutMs: 10_000,
  };
}
function runner() {
  return {
    botFingerprint: 'fixture-bot',
    forgeVersion: 'fixture-forge',
    dispose: vi.fn(),
    run: vi.fn(async () => ({
      status: 'completed' as const,
      report: {
        protocolVersion: 2 as const,
        forgeVersion: 'installed-forge',
        botFingerprint: 'Default/hybrid-simulation' as const,
        seed: 42,
        games: [{ index: 0, winner: 'Alpha' as const, turns: 12, outcome: 'AllOpponentsLost', log: [] }],
        challenges: [],
      },
      botFingerprint: 'fixture-bot',
      forgeVersion: 'fixture-forge',
      stdout: '',
      stderr: '',
      error: null,
    })),
  };
}
it.each(['draft', 'sealed'] as const)(
  'runs reproducible %s decks without claiming card or bridge qualification',
  async (mode) => {
    const options = await input(mode);
    const native = runner();
    const result = await runPrintedNativeSmoke(options, () => native);
    expect(result.status).toBe('completed-native-game');
    expect(result.qualification).toBe('unproven');
    expect(result.bridgeCoverage).toBe('not-exercised');
    expect(result.formatId).toBe('akh-hou');
    expect(result.catalogs).toHaveLength(3);
    expect(result.formatFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.decks).toHaveLength(2);
    for (const deck of result.decks) {
      expect(deck.cards).toHaveLength(40);
      expect(new Set(deck.selectedPhysicalIds).size).toBe(deck.selectedPhysicalIds.length);
      expect(deck.selectedPhysicalIds.every((id) => deck.poolPhysicalIds.includes(id))).toBe(true);
      const contents = await readFile(join(options.outputDirectory, deck.file), 'utf8');
      expect(contents).toContain('[main]');
      expect(contents).toMatch(/\|(AKH|HOU|MP2)/u);
    }
    expect(native.dispose).toHaveBeenCalledOnce();
    expect(native.run).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(join(options.outputDirectory, 'report.json'), 'utf8'))).toEqual(result);
    await expect(runPrintedNativeSmoke(options, () => native)).rejects.toThrow();
    expect(native.run).toHaveBeenCalledOnce();
    const replay = await runPrintedNativeSmoke(
      { ...options, outputDirectory: `${options.outputDirectory}-replay` },
      runner,
    );
    expect(replay.decks).toEqual(result.decks);
    expect(replay.formatFingerprint).toBe(result.formatFingerprint);
  },
);
it('preserves incomplete native results without treating an imported deck as passing', async () => {
  const options = await input();
  const native = {
    ...runner(),
    run: vi.fn(async () => ({
      status: 'incomplete' as const,
      report: null,
      botFingerprint: 'fixture-bot',
      forgeVersion: 'fixture-forge',
      stdout: '',
      stderr: 'decision failure',
      error: 'Forge failed',
    })),
  };
  const result = await runPrintedNativeSmoke(options, () => native);
  expect(result.status).toBe('failed');
  expect(result.native.error).toBe('Forge failed');
  expect(result.qualification).toBe('unproven');
  expect(native.dispose).toHaveBeenCalledOnce();
});
it('rejects invalid inputs and checksum drift before creating a runner', async () => {
  const options = await input();
  const factory = vi.fn(runner);
  await expect(runPrintedNativeSmoke({ ...options, seed: -1 }, factory)).rejects.toThrow();
  await expect(runPrintedNativeSmoke({ ...options, catalogs: [] }, factory)).rejects.toThrow();
  const catalog = options.catalogs[0] as Record<string, unknown> & { cards: unknown[] };
  const changed = { ...catalog, cards: catalog.cards.slice(1) };
  await expect(
    runPrintedNativeSmoke({ ...options, catalogs: [changed, ...options.catalogs.slice(1)] }, factory),
  ).rejects.toThrow();
  expect(factory).not.toHaveBeenCalled();
});
it('disposes the runner when a native launch throws', async () => {
  const options = await input();
  const native = {
    ...runner(),
    run: vi.fn(async () => {
      throw new Error('launch refused');
    }),
  };
  await expect(runPrintedNativeSmoke(options, () => native)).rejects.toThrow('launch refused');
  expect(native.dispose).toHaveBeenCalledOnce();
});
