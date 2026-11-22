import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionSpec } from '@mtg/engine';
import { measureForgeRuntime } from '../src/observed/runtime-identity';
import { snapshotForgeScenarioBackend } from './support/snapshot-backend';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mtg-snapshot-scenario-test-'));
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});
const seat = { life: 20, hand: [], library: ['Island'], battlefield: [], graveyard: [] };
const scenario = { schemaVersion: 1, active: 0, phase: 'MAIN1', seats: [seat, seat] };
const table: SessionSpec = {
  content: { kind: 'printed', format: 'akh-hou' },
  seed: 'snapshot-scenario',
  maximumTurns: 2,
  seats: [
    { name: 'Local', controller: 'local', deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] } },
    { name: 'Native', controller: 'engine', deck: { name: 'setup', cards: [{ name: 'Island', count: 60 }] } },
  ],
};
function fixture(
  exportBody = `export function installedForgeScenarioBackend(state, options) {
  return { kind: 'observed', id: 'scenario-fixture', state, options,
    open: async () => ({ ok: true, session: { close: async () => {} } }) };
}`,
) {
  mkdirSync(join(root, 'res/cardsfolder'), { recursive: true });
  mkdirSync(join(root, 'classes'));
  writeFileSync(join(root, 'forge-gui-desktop-2.0.14-jar-with-dependencies.jar'), 'fixture jar');
  writeFileSync(join(root, 'res/cardsfolder/cardsfolder.zip'), 'fixture scripts');
  writeFileSync(join(root, 'classes/ForgeBridge.class'), 'fixture bridge');
  const inputs = {
    forgeHome: root,
    bridge: { kind: 'compiled' as const, path: join(root, 'classes') },
    adapterBundlePath: join(root, 'adapter.mjs'),
  };
  writeFileSync(inputs.adapterBundlePath, exportBody);
  const identity = measureForgeRuntime(inputs);
  const manifest = join(root, 'runtime.json');
  writeFileSync(manifest, JSON.stringify({ schemaVersion: 1, inputs, identity }));
  return { inputs, identity, manifest };
}
it('loads scenario state through the measured adapter and records exact state and seat roles', async () => {
  const { inputs, identity, manifest } = fixture();
  const journal = join(root, 'usage.jsonl');
  vi.stubEnv('MTG_FORGE_TEST_SNAPSHOT_USAGE', journal);
  const backend = await snapshotForgeScenarioBackend(scenario, { timeoutMs: 1234 }, manifest);
  expect(backend).toMatchObject({
    id: 'scenario-fixture',
    state: scenario,
    options: { timeoutMs: 1234, forgeHome: root, compiledBridgeClasses: inputs.bridge.path },
  });
  await backend!.open(table);
  expect(JSON.parse(readFileSync(journal, 'utf8'))).toMatchObject({
    runtime: identity,
    controllers: ['local', 'engine'],
    formatId: 'akh-hou',
    scenario: {
      state: scenario,
      sha256: createHash('sha256').update(JSON.stringify(scenario)).digest('hex'),
      seed: table.seed,
      maximumTurns: table.maximumTurns,
    },
  });
});
it('closes an opened session when the usage journal cannot be written', async () => {
  const closed = join(root, 'closed');
  const { manifest } = fixture(`import { writeFileSync } from 'node:fs';
    export function installedForgeScenarioBackend() { return {
      kind: 'observed', id: 'fixture', open: async () => ({ ok: true, session: {
        close: async () => writeFileSync(${JSON.stringify(closed)}, 'closed')
      } })
    }; }`);
  vi.stubEnv('MTG_FORGE_TEST_SNAPSHOT_USAGE', join(root, 'absent', 'usage.jsonl'));
  const backend = await snapshotForgeScenarioBackend(scenario, {}, manifest);
  await expect(backend!.open(table)).rejects.toThrow(/ENOENT/);
  expect(readFileSync(closed, 'utf8')).toBe('closed');
});
it('does not journal unsuccessful opens as scenario executions', async () => {
  const { manifest } = fixture(`export function installedForgeScenarioBackend() { return {
    kind: 'observed', id: 'fixture', open: async () => ({ ok: false, error: { message: 'fixture failure' } })
  }; }`);
  const journal = join(root, 'usage.jsonl');
  writeFileSync(journal, '');
  vi.stubEnv('MTG_FORGE_TEST_SNAPSHOT_USAGE', journal);
  const backend = await snapshotForgeScenarioBackend(scenario, {}, manifest);
  expect(await backend!.open(table)).toMatchObject({ ok: false });
  expect(readFileSync(journal, 'utf8')).toBe('');
});
it('refuses a changed runtime without loading its adapter', async () => {
  const { inputs, manifest } = fixture();
  writeFileSync(inputs.adapterBundlePath, 'throw new Error("must not import");');
  await expect(snapshotForgeScenarioBackend(scenario, {}, manifest)).rejects.toThrow(/identity mismatch/);
});
it('refuses missing scenario exports instead of launching a normal game', async () => {
  const { manifest } = fixture(
    'export function installedForgeBackend() { throw new Error("wrong constructor"); }',
  );
  await expect(snapshotForgeScenarioBackend(scenario, {}, manifest)).rejects.toThrow(
    /does not export installedForgeScenarioBackend/,
  );
});
it('validates state before any snapshot IO and forbids unmeasured overrides', async () => {
  await expect(
    snapshotForgeScenarioBackend({ ...scenario, active: 3 }, {}, join(root, 'missing.json')),
  ).rejects.not.toThrow(/ENOENT/);
  const { manifest } = fixture();
  await expect(
    snapshotForgeScenarioBackend(scenario, { compiledBridgeClasses: '/unmeasured' }, manifest),
  ).rejects.toThrow(/override/);
  await expect(snapshotForgeScenarioBackend(scenario, {}, join(root, 'missing.json'))).rejects.toThrow(
    /ENOENT/,
  );
});
it('rejects an absent measured backend rather than falling back', async () => {
  const { manifest } = fixture('export function installedForgeScenarioBackend() { return null; }');
  await expect(snapshotForgeScenarioBackend(scenario, {}, manifest)).rejects.toThrow(
    /Snapshot Forge is absent/,
  );
});
describe('suite > literal separator', () => {
  describe('nested suite', () => {
    it.each(['quoted name'])('captures %s without flattening suite identity', async () => {
      const { manifest } = fixture();
      const journal = join(root, 'usage.jsonl');
      vi.stubEnv('MTG_FORGE_TEST_SNAPSHOT_USAGE', journal);
      const backend = await snapshotForgeScenarioBackend(scenario, {}, manifest);
      await backend!.open(table);
      expect(JSON.parse(readFileSync(journal, 'utf8')).testIdentity).toEqual({
        id: expect.any(String),
        ancestorTitles: ['suite > literal separator', 'nested suite'],
        title: 'captures quoted name without flattening suite identity',
      });
    });
  });
});
