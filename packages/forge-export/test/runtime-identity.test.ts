import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { measureForgeRuntime } from '../src/observed/runtime-identity';
import { FORGE_BRIDGE_PROTOCOL_VERSION } from '../src/observed/protocol';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mtg-runtime-identity-test-'));
  mkdirSync(join(root, 'res/cardsfolder'), { recursive: true });
  writeFileSync(join(root, 'forge-gui-desktop-2.0.14-jar-with-dependencies.jar'), 'jar bytes');
  writeFileSync(join(root, 'res/cardsfolder/cardsfolder.zip'), 'script bytes');
  writeFileSync(join(root, 'ForgeBridge.java'), 'bridge bytes');
  writeFileSync(join(root, 'adapter.mjs'), 'adapter bytes');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function options() {
  return {
    forgeHome: root,
    bridge: { kind: 'source' as const, path: join(root, 'ForgeBridge.java') },
    adapterBundlePath: join(root, 'adapter.mjs'),
  };
}

it('measures selected installed bytes rather than accepting claimed hashes', () => {
  const result = measureForgeRuntime(options());
  expect(result).toMatchObject({
    forgeVersion: '2.0.14',
    forgeJarSha256: hash('jar bytes'),
    scriptArchiveSha256: hash('script bytes'),
    adapterSha256: hash('adapter bytes'),
    protocolVersion: FORGE_BRIDGE_PROTOCOL_VERSION,
  });
  expect(result.bridgeSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(measureForgeRuntime(options())).toEqual(result);
});

it.each(['tokenscripts/cat.txt', 'ai/default.ai'])(
  'invalidates runtime identity when resource %s changes',
  (file) => {
    const path = join(root, 'res', file);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, 'original resource');
    const before = measureForgeRuntime(options());
    writeFileSync(path, 'changed resource');
    expect(measureForgeRuntime(options())).not.toEqual(before);
  },
);

it.each([
  ['forge-gui-desktop-2.0.14-jar-with-dependencies.jar', 'forgeJarSha256'],
  ['ForgeBridge.java', 'bridgeSha256'],
  ['adapter.mjs', 'adapterSha256'],
] as const)('invalidates identity when %s changes', (file, field) => {
  const before = measureForgeRuntime(options());
  writeFileSync(join(root, file), 'changed bytes');
  const after = measureForgeRuntime(options());
  expect(after[field]).not.toBe(before[field]);
  expect({ ...after, [field]: before[field] }).toEqual(before);
});

it('binds the card archive both independently and within the full resource tree', () => {
  const before = measureForgeRuntime(options());
  writeFileSync(join(root, 'res/cardsfolder/cardsfolder.zip'), 'changed archive');
  const after = measureForgeRuntime(options());
  expect(after.scriptArchiveSha256).not.toBe(before.scriptArchiveSha256);
  expect(after.resourcesSha256).not.toBe(before.resourcesSha256);
  expect({
    ...after,
    scriptArchiveSha256: before.scriptArchiveSha256,
    resourcesSha256: before.resourcesSha256,
  }).toEqual(before);
});

it('binds resource additions and removals and rejects symbolic resource entries', () => {
  const before = measureForgeRuntime(options());
  const resource = join(root, 'res/ai-profile');
  writeFileSync(resource, 'profile');
  expect(measureForgeRuntime(options()).resourcesSha256).not.toBe(before.resourcesSha256);
  rmSync(resource);
  expect(measureForgeRuntime(options())).toEqual(before);
  symlinkSync(join(root, 'adapter.mjs'), resource);
  expect(() => measureForgeRuntime(options())).toThrow(/symbolic link/i);
});

it('binds all compiled companion classes, including additions, without path dependence', () => {
  const first = join(root, 'first');
  const second = join(root, 'second');
  for (const path of [first, second]) {
    mkdirSync(path);
    writeFileSync(join(path, 'ForgeBridge.class'), 'main');
    writeFileSync(join(path, 'ForgeBridge$Session.class'), 'inner');
  }
  const measure = (path: string) => measureForgeRuntime({ ...options(), bridge: { kind: 'compiled', path } });
  expect(measure(first)).toEqual(measure(second));
  const before = measure(first);
  writeFileSync(join(first, 'ForgeBridge$Session.class'), 'new inner');
  expect(measure(first).bridgeSha256).not.toBe(before.bridgeSha256);
  writeFileSync(join(second, 'ForgeBridge$Extra.class'), 'extra');
  expect(measure(second).bridgeSha256).not.toBe(before.bridgeSha256);
  expect(before.bridgeSha256).not.toBe(measureForgeRuntime(options()).bridgeSha256);
});

it('refuses absent inputs and compiled class directories without the entrypoint', () => {
  expect(() => measureForgeRuntime({ ...options(), forgeHome: join(root, 'absent') })).toThrow(
    /not installed/i,
  );
  expect(() => measureForgeRuntime({ ...options(), adapterBundlePath: join(root, 'absent') })).toThrow();
  expect(() => measureForgeRuntime({ ...options(), bridge: { kind: 'compiled', path: root } })).toThrow(
    /ForgeBridge.class/,
  );
  rmSync(join(root, 'res/cardsfolder/cardsfolder.zip'));
  expect(() => measureForgeRuntime(options())).toThrow();
});

it('refuses symlinked class entries instead of omitting executable bytes', () => {
  mkdirSync(join(root, 'classes'));
  symlinkSync(join(root, 'ForgeBridge.java'), join(root, 'classes/ForgeBridge.class'));
  expect(() =>
    measureForgeRuntime({
      ...options(),
      bridge: { kind: 'compiled', path: join(root, 'classes') },
    }),
  ).toThrow(/symbolic link/i);
});

it('includes nested classpath resources and is independent of directory creation order', () => {
  const first = join(root, 'classes-a');
  const second = join(root, 'classes-b');
  for (const path of [first, second]) mkdirSync(join(path, 'resources'), { recursive: true });
  writeFileSync(join(first, 'ForgeBridge.class'), 'main');
  writeFileSync(join(first, 'resources/config.json'), 'original resource');
  writeFileSync(join(second, 'resources/config.json'), 'original resource');
  writeFileSync(join(second, 'ForgeBridge.class'), 'main');
  const measure = (path: string) => measureForgeRuntime({ ...options(), bridge: { kind: 'compiled', path } });
  expect(measure(first)).toEqual(measure(second));
  writeFileSync(join(second, 'resources/config.json'), 'changed resource');
  expect(measure(first).bridgeSha256).not.toBe(measure(second).bridgeSha256);
});
