import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ForgeRuntimeSnapshot } from '@mtg/forge-export';
import { openPinnedInstalledForgeBackend } from '../../tools/pinned-forge-backend';
import { SNAPSHOT_FORGE_REMOVED_MESSAGE } from '../../tools/isolated-observed-backend';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mtg-pinned-forge-backend-test-'));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

it('loads only the snapshot adapter, confines format, and disposes after shutdown', async () => {
  const adapter = join(root, 'adapter.mjs');
  writeFileSync(
    adapter,
    `export function installedForgeBackend(options) {
      return {
        id: 'pinned-fixture', determinism: 'observed',
        capabilities: { undo: false, fork: false, perSeatProjection: true, engineSeats: true },
        supports: async () => [],
        open: async () => ({ ok: false, error: { kind: 'backend-failure', message: options.forgeHome } }),
        shutdown: async () => {}
      };
    }`,
  );
  const dispose = vi.fn();
  const snapshot = {
    inputs: {
      forgeHome: join(root, 'forge'),
      bridge: { kind: 'compiled', path: join(root, 'classes') },
      adapterBundlePath: adapter,
    },
    identity: {},
    dispose,
  } as unknown as ForgeRuntimeSnapshot;
  const backend = await openPinnedInstalledForgeBackend(snapshot, 'legacy-cube-2021-08');
  const table = (format: string) => ({
    content: { kind: 'printed' as const, format },
    seats: [
      { name: 'local', controller: 'local' as const, deck: { name: 'a', cards: [] } },
      { name: 'engine', controller: 'engine' as const, deck: { name: 'b', cards: [] } },
    ] as const,
    seed: 'seed',
    maximumTurns: 2,
  });

  expect(await backend.supports(table('other'))).toEqual([expect.stringMatching(/legacy-cube-2021-08/)]);
  const refused = await backend.open(table('other'));
  if (refused.ok) throw new Error('unexpected open');
  expect(refused.error).toMatchObject({ kind: 'content-unsupported' });
  const opened = await backend.open(table('legacy-cube-2021-08'));
  if (opened.ok) throw new Error('unexpected open');
  expect(opened.error).toMatchObject({
    kind: 'backend-failure',
    message: snapshot.inputs.forgeHome,
  });
  await backend.shutdown?.();
  await backend.shutdown?.();
  expect(dispose).toHaveBeenCalledTimes(1);
});

it('tells the operator to restart when the owned Forge snapshot disappears', async () => {
  const adapter = join(root, 'missing-adapter.mjs');
  writeFileSync(
    adapter,
    `let calls = 0;
    export function installedForgeBackend() {
      calls += 1;
      if (calls > 1) return null;
      return {
        id: 'pinned-fixture', determinism: 'observed',
        capabilities: { undo: false, fork: false, perSeatProjection: true, engineSeats: true },
        supports: async () => [],
        open: async () => { throw new Error('probe cannot open'); },
        shutdown: async () => {}
      };
    }`,
  );
  const dispose = vi.fn();
  const snapshot = {
    inputs: {
      forgeHome: join(root, 'forge'),
      bridge: { kind: 'compiled', path: join(root, 'classes') },
      adapterBundlePath: adapter,
    },
    identity: {},
    dispose,
  } as unknown as ForgeRuntimeSnapshot;
  const backend = await openPinnedInstalledForgeBackend(snapshot, 'legacy-cube-2021-08');

  const opened = await backend.open({
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      { name: 'local', controller: 'local', deck: { name: 'a', cards: [] } },
      { name: 'engine', controller: 'engine', deck: { name: 'b', cards: [] } },
    ],
    seed: 'missing-snapshot',
    maximumTurns: 2,
  });

  expect(opened).toEqual({
    ok: false,
    error: { kind: 'backend-failure', message: SNAPSHOT_FORGE_REMOVED_MESSAGE },
  });
  await backend.shutdown?.();
  expect(dispose).toHaveBeenCalledTimes(1);
});
